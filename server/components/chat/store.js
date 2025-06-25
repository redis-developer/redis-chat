import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from "redis";
import config from "../../config";
import getClient from "../../redis";
import { embedText, llm } from "../../services/ai/ai";
import { float32ToBuffer } from "../../utils/convert";

/**
 * An error object
 * @typedef {Object} ChatError
 * @property {number} status
 * @property {string} message
 *
 * A chat object
 * @typedef {Object} Chat
 * @property {number} [distance]
 * @property {string} originalPrompt
 * @property {string} inferredQuestion
 * @property {string} cacheJustification
 * @property {number} recommendedTtl
 * @property {string} response
 * @property {number[]} embedding
 *
 * A chat document
 * @typedef {Object} ChatDocument
 * @property {string} id
 * @property {Chat} value
 *
 * A chat object
 * @typedef {Object} Chats
 * @property {number} total
 * @property {ChatDocument[]} documents
 */

const {
  LONG_TERM_MEMORY_INDEX,
  LONG_TERM_MEMORY_PREFIX,
  GLOBAL_MEMORY_INDEX,
  GLOBAL_MEMORY_PREFIX,
} = config.redis;

/**
 * Generates a Redis index name for long-term memory based on the session ID.
 *
 * @param {string} sessionId - The session ID for which to generate the index name.
 */
export function getLongTermMemoryIndex(sessionId) {
  return `${LONG_TERM_MEMORY_INDEX}-${sessionId}`;
}

/**
 * Checks if the index already exists in Redis
 *
 * @param {string} name - The name of the index to check for existence.
 *
 * @returns {Promise<boolean>}
 */
export async function haveIndex(name) {
  const redis = getClient();
  const indexes = await redis.ft._list();

  return indexes.some((index) => {
    return index === name;
  });
}

/**
 * Creates a Redis index for chat messages.
 *
 * @param {string} name - The name of the index to create.
 * @param {string} prefix - The prefix for the index.
 */
export async function createIndex(name, prefix) {
  const redis = getClient();
  await redis.ft.create(
    name,
    {
      "$.embedding": {
        type: SCHEMA_FIELD_TYPE.VECTOR,
        TYPE: "FLOAT32",
        ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.FLAT,
        DIM: llm.dimensions,
        DISTANCE_METRIC: "L2",
        AS: "embedding",
      },
      "$.originalPrompt": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "originalPrompt",
      },
      "$.inferredQuestion": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "inferredQuestion",
      },
      "$.cacheJustification": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "cacheJustification",
      },
      "$.recommendedTtl": {
        type: SCHEMA_FIELD_TYPE.NUMERIC,
        AS: "recommendedTtl",
      },
      "$.response": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "response",
      },
    },
    {
      ON: "JSON",
      PREFIX: prefix,
    },
  );
}

/**
 * Creates the CHAT_INDEX if it doesn't exist already
 *
 * @param {string | null} [sessionId=null] - The session ID for which to create the index.
 */
export async function createIndexIfNotExists(sessionId = null) {
  const haveGlobalIndex = await haveIndex(GLOBAL_MEMORY_INDEX);

  if (!haveGlobalIndex) {
    await createIndex(GLOBAL_MEMORY_INDEX, GLOBAL_MEMORY_PREFIX);
  }

  if (sessionId) {
    const longTermIndex = getLongTermMemoryIndex(sessionId);
    const longTermPrefix = `${LONG_TERM_MEMORY_PREFIX}${sessionId}:`;
    const haveLongTermIndex = await haveIndex(longTermIndex);

    if (!haveLongTermIndex) {
      await createIndex(longTermIndex, longTermPrefix);
    }
  }
}

/**
 * Caches a prompt in Redis with its embedding and metadata.
 *
 * @param {string} id - The unique identifier for the chat document.
 * @param {Omit<Chat, "embedding">} chat
 * @param {Object} options - Options for caching the prompt.
 * @param {string} options.sessionId - The session ID for the chat.
 * @param {boolean} options.longTermMemory - Store in long-term memory.
 * @param {boolean} options.globalMemory - Store in global memory.
 *
 * @returns {Promise<ChatDocument>} - The cached chat document.
 */
export async function cachePrompt(
  id,
  {
    originalPrompt,
    inferredQuestion,
    cacheJustification,
    response,
    recommendedTtl,
  },
  { sessionId, longTermMemory, globalMemory },
) {
  const redis = getClient();
  const embedding = await embedText(inferredQuestion);
  let CHAT_PREFIX = config.redis.GLOBAL_MEMORY_PREFIX;

  if (longTermMemory) {
    CHAT_PREFIX = `${config.redis.LONG_TERM_MEMORY_PREFIX}${sessionId}:`;
  }

  const fullId = `${CHAT_PREFIX}${id}`;

  await redis.json.set(fullId, "$", {
    originalPrompt,
    embedding,
    inferredQuestion,
    cacheJustification,
    recommendedTtl,
    response,
  });

  if (recommendedTtl > 0) {
    await redis.expire(fullId, recommendedTtl);
  }

  return /** @type {ChatDocument} */ {
    id,
    value: {
      originalPrompt,
      embedding,
      inferredQuestion,
      cacheJustification,
      recommendedTtl,
      response,
    },
  };
}

/**
 * Looks up a chat message in Redis based on its embedding.
 *
 * @param {number[]} embedding - The embedding vector to search for.
 * @param {string} index - The index to search in (short-term, long-term, or global memory).
 * @param {Object} options - Options for the lookup.
 * @param {number} [options.count=1] - The number of results to return.
 */
async function lookup(embedding, index, { count = 1 } = {}) {
  const redis = getClient();
  return /** @type {Chats} */ (
    await redis.ft.search(
      index,
      `*=>[KNN ${count} @embedding $BLOB AS distance]`,
      {
        PARAMS: {
          BLOB: float32ToBuffer(embedding),
        },
        RETURN: [
          "distance",
          "originalPrompt",
          "cacheJustification",
          "inferredQuestion",
          "recommendedTtl",
          "response",
        ],
        SORTBY: {
          BY: /** @type {`${'@' | '$.'}${string}`} */ ("distance"),
        },
        DIALECT: 2,
      },
    )
  );
}

/**
 * Searches for similar chat messages based on the provided prompt.
 *
 * @param {string} prompt - The prompt to search for similar chat messages.
 * @param {Object} memory - Memory options for the search.
 * @param {string} [memory.sessionId] - The session ID for the chat.
 * @param {boolean} [memory.longTermMemory=false] - Whether to search in long-term memory.
 * @param {boolean} [memory.globalMemory=false] - Whether to search in global memory.
 * @param {Object} options - Options for the search.
 * @param {number} [options.count=3] - The number of results to return.
 * @param {number} [options.maxDistance=0.5] - The maximum distance for similarity.
 */
export async function vss(
  prompt,
  { sessionId, longTermMemory, globalMemory } = {},
  { count = 1, maxDistance = 0.5 } = {},
) {
  const redis = getClient();
  const embedding = await embedText(prompt);

  /** @type {ChatDocument[]} */
  let documents = [];

  if (longTermMemory && sessionId) {
    const result = await lookup(embedding, getLongTermMemoryIndex(sessionId), {
      count,
    });

    documents.push(...result.documents);
  }

  if (globalMemory) {
    const result = await lookup(embedding, config.redis.GLOBAL_MEMORY_INDEX, {
      count,
    });

    documents.push(...result.documents);
  }

  documents = documents
    .filter((doc) => {
      return (doc.value.distance ?? maxDistance + 1) <= maxDistance;
    })
    .slice(0, count);

  return {
    total: documents.length,
    documents,
  };
}

/**
 * Adds a chat message to the Redis stream for a given session.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @param {Object} params - The parameters for the chat message.
 * @param {string} params.id - The unique ID for the chat message.
 * @param {string} params.message - The chat message content.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 */
export async function addChatMessage(sessionId, { id, message, isLocal }) {
  const client = getClient(); // Unique ID based on session and timestamp

  const messageKey = `${config.redis.MESSAGE_PREFIX}${sessionId}:${id}`;
  await client.set(messageKey, message);
  const streamId = await client.xAdd(
    `${config.redis.CHAT_STREAM_PREFIX}${sessionId}`,
    "*",
    {
      timestamp: Date.now().toString(), // Store timestamp as string
      messageKey: messageKey,
      isLocal: isLocal.toString(),
    },
  );

  return streamId;
}

/**
 * Retrieves the message before a specified message ID in a chat session.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} entryId - The stream entry ID of the message to find the previous message for.
 */
export async function getPreviousChatMessage(sessionId, entryId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}`;

  // Get the message before the specified message ID
  const entries = await client.xRevRange(streamKey, entryId, "-", {
    COUNT: 2,
  });

  if (entries.length === 0) {
    return null; // No message found before the specified ID
  }

  const entry = entries[1];
  const { id, timestamp, messageKey, isLocal } = entry.message;

  return {
    id,
    timestamp: parseInt(timestamp, 10),
    message: (await client.get(messageKey)) ?? "",
    messageKey,
    isLocal: isLocal === "true",
  };
}

/**
 * Changes the content of a specific chat message in the Redis stream.
 *
 * @param {string} id - The unique ID of the chat message to change.
 * @param {string} newValue - The new content for the chat message.
 */
export async function changeChatMessage(id, newValue) {
  const client = getClient();

  await client.set(id, newValue);
}

/**
 * Retrieves a specific chat message by its entry ID from the Redis stream.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} entryId - The stream entry ID of the message to retrieve.
 */
export async function getChatMessage(sessionId, entryId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}`;

  // Get the specific message by entry ID
  const entries = await client.xRange(streamKey, entryId, entryId);

  if (entries.length === 0) {
    return null; // No message found for the specified entry ID
  }

  const entry = entries[0];
  const { id, timestamp, messageKey, isLocal } = entry.message;
  return {
    id,
    timestamp: parseInt(timestamp, 10),
    message: await client.get(messageKey),
    messageKey,
    isLocal: isLocal === "true",
  };
}

/**
 * Retrieves all chat messages from the Redis stream for a given session.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @returns {Promise<Array<{ entryId: string; id: string; timestamp: number; message: string; messageKey: string; isLocal: boolean }>>} - A promise resolving to an array of chat messages.
 */
export async function getChatMessages(sessionId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}`;

  // '-' means the minimum possible ID, '+' means the maximum possible ID
  const streamEntries = await client.xRange(streamKey, "-", "+");

  const messages = await Promise.all(
    streamEntries.map(async (entry) => {
      const { id, timestamp, messageKey, isLocal } = entry.message;

      return {
        entryId: entry.id,
        id,
        timestamp: parseInt(timestamp, 10),
        message: (await client.get(messageKey)) ?? "",
        messageKey,
        isLocal: isLocal === "true",
      };
    }),
  );

  return messages;
}

/**
 * Deletes all chat messages from the Redis stream for a given session.
 *
 * @param {string} sessionId - The ID of the chat session.
 */
export async function deleteChatMessages(sessionId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}`;

  const messages = await getChatMessages(sessionId);
  await client.del(
    [streamKey].concat(
      messages.map((message) => {
        return message.messageKey;
      }),
    ),
  );
}

/**
 * Flushes all data in Redis.
 */
export async function deleteKeys() {
  const client = getClient();

  const redis = getClient();
  const indexes = await redis.ft._list();

  for (const index of indexes) {
    if (index.includes(config.redis.LONG_TERM_MEMORY_INDEX)) {
      await redis.ft.dropIndex(index);
    } else if (index.includes(config.redis.GLOBAL_MEMORY_INDEX)) {
      await redis.ft.dropIndex(index);
    }
  }

  await client.del([
    ...(await client.keys(`${config.redis.LONG_TERM_MEMORY_PREFIX}*`)),
    ...(await client.keys(`${config.redis.GLOBAL_MEMORY_PREFIX}*`)),
    ...(await client.keys(`${config.redis.CHAT_STREAM_PREFIX}*`)),
    ...(await client.keys(`${config.redis.SESSION_PREFIX}*`)),
    ...(await client.keys(`${config.redis.MESSAGE_PREFIX}*`)),
    config.log.ERROR_STREAM,
    config.log.LOG_STREAM,
  ]);

  await createIndexIfNotExists();
}
