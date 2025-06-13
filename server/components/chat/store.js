import { SchemaFieldTypes, VectorAlgorithms } from "redis";
import config from "../../config.js";
import getClient from "../../redis.js";
import { embedText } from "../../utils/ai.js";
import logger from "../../utils/log.js";
import { float32ToBuffer } from "../../utils/convert.js";

/**
 * An error object
 * @typedef {Object} ChatError
 * @property {number} status
 * @property {string} message
 *
 * A chat object
 * @typedef {Object} Chat
 * @property {string} originalPrompt
 * @property {string} inferredPrompt
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

const CHAT_INDEX = config.redis.CHAT_INDEX;
const CHAT_PREFIX = config.redis.CHAT_PREFIX;

/**
 * Checks if the CHAT_INDEX already exists in Redis
 *
 * @returns {Promise<boolean>}
 */
export async function haveIndex() {
  const redis = getClient();
  const indexes = await redis.ft._list();

  return indexes.some((index) => {
    return index === CHAT_INDEX;
  });
}

/**
 * Creates the CHAT_INDEX if it doesn't exist already
 */
export async function createIndexIfNotExists() {
  if (await haveIndex()) {
    logger.info(`Index ${CHAT_INDEX} already exists.`);
    return;
  }

  const redis = getClient();
  await redis.ft.create(
    CHAT_INDEX,
    {
      "$.embedding": {
        type: SchemaFieldTypes.VECTOR,
        TYPE: "FLOAT32",
        ALGORITHM: VectorAlgorithms.FLAT,
        DIM: config.openai.EMBEDDINGS_DIMENSIONS,
        DISTANCE_METRIC: "L2",
        AS: "embedding",
      },
      "$.originalPrompt": {
        type: SchemaFieldTypes.TEXT,
        AS: "originalPrompt",
      },
      "$.inferredPrompt": {
        type: SchemaFieldTypes.TEXT,
        AS: "inferredPrompt",
      },
      "$.cacheJustification": {
        type: SchemaFieldTypes.TEXT,
        AS: "cacheJustification",
      },
      "$.recommendedTtl": {
        type: SchemaFieldTypes.NUMERIC,
        AS: "recommendedTtl",
      },
      "$.response": {
        type: SchemaFieldTypes.TEXT,
        AS: "response",
      },
    },
    {
      ON: "JSON",
      PREFIX: CHAT_PREFIX,
    },
  );
}

/**
 * Caches a prompt in Redis with its embedding and metadata.
 *
 * @param {string} id - The unique identifier for the chat document.
 * @param {Chat} chat
 *
 * @returns {Promise<ChatDocument>} - The cached chat document.
 */
export async function cachePrompt(
  id,
  {
    originalPrompt,
    inferredPrompt,
    cacheJustification,
    response,
    recommendedTtl,
  },
) {
  const redis = getClient();
  const embedding = await embedText(inferredPrompt);
  const fullId = `${CHAT_PREFIX}${id}`;

  try {
    await redis.json.set(fullId, "$", {
      originalPrompt,
      embedding,
      inferredPrompt,
      cacheJustification,
      recommendedTtl,
      response,
    });

    if (recommendedTtl > 0) {
      await redis.expire(fullId, recommendedTtl);
    }

    logger.info(`Prompt cached with key ${fullId}`);

    return /** @type {ChatDocument} */ {
      id,
      value: {
        originalPrompt,
        embedding,
        inferredPrompt,
        cacheJustification,
        recommendedTtl,
        response,
      },
    };
  } catch (error) {
    logger.error("Error caching prompt:", error);
    throw error;
  }
}

/**
 * Searches for similar chat messages based on the provided prompt.
 *
 * @param {string} prompt - The prompt to search for similar chat messages.
 * @param {Object} options - Options for the search.
 * @param {number} [options.count=3] - The number of results to return.
 * @param {number} [options.maxDistance=0.5] - The maximum distance for similarity.
 */
export async function vss(prompt, { count = 1, maxDistance = 0.5 } = {}) {
  const redis = getClient();
  const embedding = await embedText(prompt);

  try {
    logger.info("Searching cache for matching prompt:", prompt);

    const result = /** @type {Chats} */ (
      await redis.ft.search(
        CHAT_INDEX,
        `*=>[KNN ${count} @embedding $BLOB AS distance]`,
        {
          PARAMS: {
            BLOB: float32ToBuffer(embedding),
          },
          RETURN: [
            "distance",
            "originalPrompt",
            "cacheJustification",
            "inferredPrompt",
            "recommendedTtl",
            "response",
          ],
          SORTBY: {
            BY: "distance",
          },
          DIALECT: 2,
        },
      )
    );

    result.documents = result.documents.filter((doc) => {
      return doc.value.distance <= maxDistance;
    });
    result.total = result.documents.length;

    return result;
  } catch (error) {
    logger.error("Error in vss:", error);
    throw error;
  }
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

  try {
    const streamId = await client.xAdd(
      `${config.redis.CHAT_STREAM_PREFIX}${sessionId}`,
      "*",
      {
        id,
        timestamp: Date.now().toString(), // Store timestamp as string
        message: message,
        isLocal: isLocal.toString(),
      },
    );
    logger.info(`Message added to stream chat:${sessionId}`);

    return streamId;
  } catch (error) {
    logger.error(`Failed to add message to stream chat:${sessionId}:`, error);
    // Depending on requirements, you might want to re-throw or handle the error differently
    throw error;
  }
}

/**
 * Retrieves all chat messages from the Redis stream for a given session.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @returns {Promise<Array<{ id: string, timestamp: number, message: string, isLocal: boolean }>>} - A promise resolving to an array of chat messages.
 */
export async function getChatMessages(sessionId) {
  const client = getClient();
  const streamKey = `${config.redis.CHAT_STREAM_PREFIX}${sessionId}`;

  try {
    // '-' means the minimum possible ID, '+' means the maximum possible ID
    const streamEntries = await client.xRange(streamKey, "-", "+");

    const messages = streamEntries.map((entry) => {
      const { id, timestamp, message, isLocal } = entry.message;

      return {
        id,
        timestamp: parseInt(timestamp, 10),
        message: message,
        isLocal: isLocal === "true",
      };
    });

    logger.info(
      `Retrieved ${messages.length} messages from stream ${streamKey}`,
    );
    return messages;
  } catch (error) {
    logger.error(
      `Failed to retrieve messages from stream ${streamKey}:`,
      error,
    );
    throw error;
  }
}
