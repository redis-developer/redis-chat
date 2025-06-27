import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from "redis";
import config from "../../config";
import getClient from "../../redis";
import { embedText, llm } from "../../services/ai/ai";
import { float32ToBuffer } from "../../utils/convert";
import { randomUlid } from "../../utils/uid";

/**
 * An error object
 * @typedef {Object} ChatError
 * @property {number} status
 * @property {string} message
 *
 * A chat object
 * @typedef {Object} Chat
 * @property {number} [distance]
 * @property {string} [sessionId]
 * @property {string} originalQuestion
 * @property {string} inferredQuestion
 * @property {string} reasoning
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
  USER_MEMORY_INDEX,
  USER_MEMORY_PREFIX,
  SEMANTIC_MEMORY_INDEX,
  SEMANTIC_MEMORY_PREFIX,
} = config.redis;

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
 * Creates the Redis indexes for chat messages.
 */
export async function createIndexesIfNotExists() {
  const redis = getClient();

  const semanticSchema =
    /** @type {import("@redis/search").RediSearchSchema} */ ({
      "$.embedding": {
        type: SCHEMA_FIELD_TYPE.VECTOR,
        TYPE: "FLOAT32",
        ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.FLAT,
        DIM: llm.dimensions,
        DISTANCE_METRIC: "L2",
        AS: "embedding",
      },
      "$.originalQuestion": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "originalQuestion",
      },
      "$.inferredQuestion": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "inferredQuestion",
      },
      "$.reasoning": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "reasoning",
      },
      "$.recommendedTtl": {
        type: SCHEMA_FIELD_TYPE.NUMERIC,
        AS: "recommendedTtl",
      },
      "$.response": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "response",
      },
    });

  const userSchema = /** @type {import("@redis/search").RediSearchSchema} */ ({
    ...semanticSchema,
    "$.sessionId": {
      type: SCHEMA_FIELD_TYPE.TAG,
      AS: "sessionId",
      SORTABLE: true,
    },
  });

  const promises = [];
  const [haveSemanticIndex, haveUserIndex] = await Promise.all([
    haveIndex(SEMANTIC_MEMORY_INDEX),
    haveIndex(USER_MEMORY_INDEX),
  ]);

  if (!haveSemanticIndex) {
    promises.push(
      redis.ft.create(SEMANTIC_MEMORY_INDEX, semanticSchema, {
        ON: "JSON",
        PREFIX: SEMANTIC_MEMORY_PREFIX,
      }),
    );
  }

  if (!haveUserIndex) {
    promises.push(
      redis.ft.create(USER_MEMORY_INDEX, userSchema, {
        ON: "JSON",
        PREFIX: USER_MEMORY_PREFIX,
      }),
    );
  }

  await Promise.all(promises);
}

/**
 * Stores a prompt in Redis with its embedding and metadata.
 *
 * @param {string} id - The unique identifier for the chat document.
 * @param {Omit<Chat, "embedding">} chat
 * @param {Object} options - Options for caching the prompt.
 * @param {string} options.sessionId - The session ID for the chat.
 * @param {boolean} options.userMemory - Store in user memory.
 * @param {boolean} options.semanticMemory - Store in semantic memory.
 *
 * @returns {Promise<ChatDocument>} - The stored chat document.
 */
export async function storeQuestion(
  id,
  { originalQuestion, inferredQuestion, reasoning, response, recommendedTtl },
  { sessionId, userMemory, semanticMemory },
) {
  const redis = getClient();
  const embedding = await embedText(inferredQuestion);
  let CHAT_PREFIX = SEMANTIC_MEMORY_PREFIX;

  if (userMemory) {
    CHAT_PREFIX = USER_MEMORY_PREFIX;
  }
  let fullId = id;

  if (!fullId.includes(CHAT_PREFIX)) {
    fullId = `${CHAT_PREFIX}${id}`;
  }

  const chat = /** @type {Chat} */ ({
    originalQuestion,
    embedding,
    inferredQuestion,
    reasoning,
    recommendedTtl,
    response,
  });

  if (userMemory) {
    chat.sessionId = sessionId;
  }

  await redis.json.set(fullId, "$", chat);

  if (recommendedTtl > 0) {
    await redis.expire(fullId, recommendedTtl);
  }

  return /** @type {ChatDocument} */ {
    id,
    value: chat,
  };
}

/**
 * Looks up a chat message in Redis based on its embedding.
 *
 * @param {number[]} embedding - The embedding vector to search for.
 * @param {string} index - The index to search in (short-term, user, or semantic memory).
 * @param {Object} options - Options for the lookup.
 * @param {string} [options.sessionId] - The session ID for the chat.
 * @param {number} [options.count=1] - The number of results to return.
 */
async function lookup(embedding, index, { sessionId, count = 1 } = {}) {
  const redis = getClient();
  let query = `=>[KNN ${count} @embedding $BLOB AS distance]`;

  if (sessionId) {
    query = `@sessionId:{"${sessionId}"}${query}`;
  } else {
    query = `*${query}`;
  }

  return /** @type {Chats} */ (
    await redis.ft.search(index, query, {
      PARAMS: {
        BLOB: float32ToBuffer(embedding),
      },
      RETURN: [
        "distance",
        "originalQuestion",
        "reasoning",
        "inferredQuestion",
        "recommendedTtl",
        "response",
      ],
      SORTBY: {
        BY: /** @type {`${'@' | '$.'}${string}`} */ ("distance"),
      },
      DIALECT: 2,
    })
  );
}

/**
 * Searches for similar chat messages based on the provided prompt.
 *
 * @param {string} question - The prompt to search for similar chat messages.
 * @param {Object} memory - Memory options for the search.
 * @param {string} [memory.sessionId] - The session ID for the chat.
 * @param {boolean} [memory.userMemory=false] - Whether to search in user memory.
 * @param {boolean} [memory.semanticMemory=false] - Whether to search in semantic memory.
 * @param {Object} options - Options for the search.
 * @param {number} [options.count=3] - The number of results to return.
 * @param {number} [options.maxDistance=0.5] - The maximum distance for similarity.
 */
export async function search(
  question,
  { sessionId, userMemory, semanticMemory } = {},
  { count = 1, maxDistance = 0.5 } = {},
) {
  const embedding = await embedText(question);

  /** @type {ChatDocument[]} */
  let documents = [];

  if (userMemory && sessionId) {
    const result = await lookup(embedding, USER_MEMORY_INDEX, {
      sessionId,
      count,
    });

    documents.push(...result.documents);
  }

  if (semanticMemory) {
    const result = await lookup(embedding, SEMANTIC_MEMORY_INDEX, {
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
 * @param {string} chatId - The ID of the chat message.
 * @param {Object} params - The parameters for the chat message.
 * @param {string} params.id - The unique ID for the chat message.
 * @param {string} params.message - The chat message content.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 */
export async function addChatMessage(
  sessionId,
  chatId,
  { id, message, isLocal },
) {
  const client = getClient(); // Unique ID based on session and timestamp

  const messageKey = `${config.redis.MESSAGE_PREFIX}${sessionId}:${chatId}:${id}`;
  await client.set(messageKey, message);
  const streamId = await client.xAdd(
    `${config.redis.CHAT_STREAM_PREFIX}${sessionId}:${chatId}`,
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
 * @param {string} chatId - The ID of the chat message.
 * @param {string} entryId - The stream entry ID of the message to find the previous message for.
 */
export async function getPreviousChatMessage(sessionId, chatId, entryId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}:${chatId}`;

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
export async function editChatMessage(id, newValue) {
  const client = getClient();

  await client.set(id, newValue);
}

/**
 * Retrieves a specific chat message by its entry ID from the Redis stream.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} chatId - The ID of the chat message.
 * @param {string} entryId - The stream entry ID of the message to retrieve.
 */
export async function getChatMessage(sessionId, chatId, entryId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}:${chatId}`;

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
 * @param {string} chatId - The ID of the chat message.
 * @returns {Promise<Array<{ entryId: string; id: string; timestamp: number; message: string; messageKey: string; isLocal: boolean }>>} - A promise resolving to an array of chat messages.
 */
export async function getChatMessages(sessionId, chatId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}:${chatId}`;

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
 * Retrieves every chat for a given session ID and gets the last user message for that chat.
 *
 * @param {string} sessionId - The ID of the session for which to retrieve all chats.
 *
 * @returns {Promise<Array<{ id: string; chatId: string; timestamp: number; message: string; messageKey: string; isLocal: boolean }>>} - A promise resolving to an array of chat objects.
 */
export async function getAllChats(sessionId) {
  const client = getClient();
  const sessionPrefix = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}`;

  const streamKeys = await client.keys(`${sessionPrefix}:*`);

  const chats = await Promise.all(
    streamKeys.map(async (streamKey) => {
      const streamEntries = await client.xRevRange(streamKey, "+", "-", {
        COUNT: 2,
      });

      if (streamEntries.length === 0) {
        return null; // No messages in this chat
      }

      for (const entry of streamEntries) {
        const { id, timestamp, messageKey, isLocal } = entry.message;

        if (isLocal === "true") {
          // If the last message is from the local user, we return it
          return {
            id: id,
            chatId: streamKey.split(":").pop(),
            timestamp: parseInt(timestamp, 10),
            message: await client.get(messageKey),
            messageKey: messageKey,
            isLocal: isLocal === "true",
          };
        }
      }

      return null;
    }),
  );

  return /** @type {Array<{ id: string; chatId: string; timestamp: number; message: string; messageKey: string; isLocal: boolean }>} */ (
    chats.filter((chat) => chat !== null)
  );
}

/**
 * Creates a new chat session in Redis.
 *
 * @param {string} sessionId - The session for the new chat.
 *
 * @returns {string} - The Redis stream key for the new chat session.
 */
export function createChat(sessionId) {
  const id = randomUlid();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}:${id}`;

  return streamKey;
}

/**
 * Deletes all chat messages from the Redis stream for a given session.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} chatId - The ID of the chat message.
 */
export async function deleteChatMessages(sessionId, chatId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}:${chatId}`;

  const messages = await getChatMessages(sessionId, chatId);
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
export async function deleteAll() {
  const client = getClient();

  const redis = getClient();
  const indexes = await redis.ft._list();

  for (const index of indexes) {
    if (index.includes(USER_MEMORY_INDEX)) {
      await redis.ft.dropIndex(index);
    } else if (index.includes(SEMANTIC_MEMORY_INDEX)) {
      await redis.ft.dropIndex(index);
    }
  }

  await client.del([
    ...(await client.keys(`${USER_MEMORY_PREFIX}*`)),
    ...(await client.keys(`${SEMANTIC_MEMORY_PREFIX}*`)),
    ...(await client.keys(`${config.redis.CHAT_STREAM_PREFIX}*`)),
    ...(await client.keys(`${config.redis.SESSION_PREFIX}*`)),
    ...(await client.keys(`${config.redis.MESSAGE_PREFIX}*`)),
    config.log.ERROR_STREAM,
    config.log.LOG_STREAM,
  ]);

  await createIndexesIfNotExists();
}
