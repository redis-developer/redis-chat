import { answerPrompt } from "../../utils/ai.js";
import { randomBytes } from "../../utils/crypto.js";
import logger from "../../utils/log.js";
import {
  cachePrompt,
  addChatMessage,
  createIndexIfNotExists,
  getChatMessages,
  vss,
} from "./store.js";
import { renderMessage, replaceMessage } from "./view.js";

export async function initialize() {
  await createIndexIfNotExists();
}

/**
 * Checks the cache for a response to the given prompt.
 * If a cached response is found, it returns the response along with
 * the inferred prompt and cache justification.
 *
 * @param {string} prompt - The prompt to check in the cache.
 *
 * @return {Promise<import("./store.js").Chat>} - An object containing the cached response and metadata,
 */
async function checkCache(prompt) {
  const { total, documents } = await vss(prompt);

  logger.debug(`Found ${total ?? 0} results in the VSS`);
  if (total > 0) {
    const result = documents[0].value;
    return {
      response: result.response,
      originalPrompt: result.originalPrompt,
      inferredPrompt: result.inferredPrompt,
      cacheJustification: result.cacheJustification,
      recommendedTtl: result.recommendedTtl,
    };
  }
}

/**
 * Handles incoming messages from the client.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} message - The message received from the client.
 */
export async function handleMessage(send, sessionId, message) {
  const userId = `chat-user-${randomBytes(20)}`;
  const botId = `chat-bot-${randomBytes(20)}`;
  const userMessage = {
    id: userId,
    message,
    isLocal: true,
  };

  const response = {
    id: botId,
    message: "...",
    isLocal: false,
  };
  let botResponseSent = false;
  try {
    const messageHistory = await getChatMessages(sessionId);
    await addChatMessage(sessionId, userMessage);

    logger.debug(`Sending user message: ${userMessage.id}`);
    send(renderMessage(userMessage));

    logger.debug(`Sending initial response: ${response.id}`);
    send(renderMessage(response));
    botResponseSent = true;

    const cacheResult = await checkCache(message);

    if (cacheResult) {
      response.message = cacheResult.response;
    }

    if (response.message === "...") {
      const result = await answerPrompt(
        message,
        messageHistory.map((message) => ({
          role: message.isLocal ? "user" : "assistant",
          content: message.message,
        })),
      );
      response.message = result.text;
      if (result.shouldCacheResult) {
        logger.debug(`Cacheable prompt found: ${message}`);
        logger.debug(`Inferred prompt: ${result.inferredPrompt}`);
        await cachePrompt(response.id, {
          originalPrompt: message,
          inferredPrompt: result.inferredPrompt,
          response: response.message,
          cacheJustification: result.cacheJustification,
          recommendedTtl: result.recommendedTtl,
        });
      }
    }

    await addChatMessage(sessionId, response);

    logger.debug(`Replacing response: ${response.id}`);
    send(replaceMessage(response));
  } catch (error) {
    logger.error("Error handling message:", error.message);
    const message = {
      id: botId,
      message: "An error occurred while processing your message.",
      isLocal: false,
    };

    if (botResponseSent) {
      send(replaceMessage(message));
    } else {
      send(renderMessage(message));
    }
  }
}

/**
 * Initializes the chat by sending all previous messages to the WebSocket client.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 */
export async function initializeChat(send, sessionId) {
  const messages = await getChatMessages(sessionId);

  for (const message of messages) {
    send(
      renderMessage({
        id: message.id,
        message: message.message,
        isLocal: message.isLocal,
      }),
    );
  }
}
