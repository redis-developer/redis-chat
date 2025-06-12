import fs from "fs/promises";
import { SchemaFieldTypes, VectorAlgorithms } from "redis";
import config from "../../config.js";
import getClient from "../../redis.js";
import { embedText } from "../../utils/ai.js";
import { float32ToBuffer, getVectorForRedisInsight } from "../../utils/convert.js";
import { randomBytes } from "../../utils/crypto.js";

const CHAT_INDEX = config.redis.CHAT_INDEX;
const CHAT_PREFIX = config.redis.CHAT_PREFIX;

/**
 * Checks if the TODOS_INDEX already exists in Redis
 *
 * @returns {Promise<boolean>}
 */
async function haveIndex() {
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
    console.log(`Index ${CHAT_INDEX} already exists.`);
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
      "$.inferredPrompt": {
        type: SchemaFieldTypes.TEXT,
        NOSTEM: true,
        SORTABLE: true,
        AS: 'inferredPrompt',
      },
      "$.cacheJustification": {
        type: SchemaFieldTypes.TEXT,
        NOSTEM: true,
        SORTABLE: true,
        AS: 'cacheJustification',
      },
      "$.response": {
        type: SchemaFieldTypes.TEXT,
        NOSTEM: true,
        SORTABLE: true,
        AS: 'response',
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
 * @param {Object} parameters
 * @param {string} prompt - The prompt to cache.
 * @param {string} parameters.inferredPrompt - The prompt to cache.
 * @param {string} parameters.response - The response to cache.
 * @param {string} parameters.cacheJustification - Justification for caching the result.
 */
export async function cachePrompt({
  prompt,
  inferredPrompt,
  cacheJustification,
  response,
}) {
  const redis = getClient();
  const embedding = await embedText(inferredPrompt);

  try {
    await redis.json.set(
      `${CHAT_PREFIX}${await randomBytes(20)}`,
      "$",
      {
        embedding,
        inferredPrompt,
        cacheJustification,
        response
      },
    );
    console.log(`Prompt cached with key ${CHAT_PREFIX}${await randomBytes(20)}`);
  } catch (error) {
    console.error("Error caching prompt:", error);
    throw error;
  }
}

/**
 * Searches for similar chat messages based on the provided prompt.
 *
 * @param {string} prompt - The prompt to search for similar chat messages.
 */
export async function vss(prompt) {
  const redis = getClient();
  const embedding = await embedText(prompt);

  try {
    console.log("Searching cache for matching prompt:", prompt);

    const result = await redis.ft.search(
      CHAT_INDEX,
      "*=>[KNN 3 @embedding $BLOB AS score]",
      {
        PARAMS: {
          BLOB: float32ToBuffer(embedding),
        },
        RETURN: ["score", "cacheJustification", "inferredPrompt", "response"],
        SORTBY: {
          BY: "score",
        },
        DIALECT: 2,
      },
    );

    return result;
  } catch (error) {
    console.error("Error in vss:", error);
    throw error;
  }
}

/**
 * Adds a chat message to the Redis stream for a given session.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @param {Object} params - The parameters for the chat message.
 * @param {string} params.message - The chat message content.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 */
export async function addChatMessage(sessionId, { message, isLocal }) {
  const client = getClient();

  try {
    await client.xAdd(`chat:${sessionId}`, "*", {
      timestamp: Date.now().toString(), // Store timestamp as string
      message: message,
      isLocal: isLocal.toString(),
    });
    console.log(`Message added to stream chat:${sessionId}`);
  } catch (error) {
    console.error(`Failed to add message to stream chat:${sessionId}:`, error);
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
  const streamKey = `chat:${sessionId}`;

  try {
    // '-' means the minimum possible ID, '+' means the maximum possible ID
    const streamEntries = await client.xRange(streamKey, "-", "+");

    const messages = streamEntries.map((entry) => {
      const { timestamp, message, isLocal } = entry.message;

      return {
        id: entry.id,
        timestamp: parseInt(timestamp, 10),
        message: message,
        isLocal: isLocal === "true",
      };
    });

    console.log(
      `Retrieved ${messages.length} messages from stream ${streamKey}`,
    );
    return messages;
  } catch (error) {
    console.error(
      `Failed to retrieve messages from stream ${streamKey}:`,
      error,
    );
    throw error;
  }
}
