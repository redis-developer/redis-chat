import { answerPrompt } from "../../services/ai";
import { randomBytes } from "../../utils/crypto";
import logger from "../../utils/log";
import {
  cachePrompt,
  addChatMessage,
  createIndexIfNotExists,
  getChatMessages,
  vss,
  deleteChatMessages,
  getPreviousChatMessage,
  getChatMessage,
  changeChatMessage,
  deleteKeys,
} from "./store";
import * as view from "./view";

/**
 * Clears all messages for a given session.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session to clear messages for.
 */
export async function clearMessages(send, sessionId) {
  logger.debug(`Clearing messages for session: ${sessionId}`);
  await deleteChatMessages(sessionId);
  send(view.clearMessages());
}

/**
 * Clears the entire cache.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 */
export async function clearCache(send) {
  logger.debug("Flushing Redis");
  await deleteKeys();
  send(view.clearMessages());
}

/**
 * Checks the cache for a response to the given prompt.
 * If a cached response is found, it returns the response along with
 * the inferred prompt and cache justification.
 *
 * @param {string} prompt - The prompt to check in the cache.
 *
 * @return {Promise<import("./store").Chat | undefined>} - An object containing the cached response and metadata,
 */
async function findSimilarPrompt(prompt) {
  const { total, documents } = await vss(prompt);

  logger.debug(`Found ${total ?? 0} results in the VSS`);
  if (total > 0) {
    const result = documents[0].value;

    return {
      response: result.response,
      embedding: result.embedding,
      originalPrompt: result.originalPrompt,
      inferredPrompt: result.inferredPrompt,
      cacheJustification: result.cacheJustification,
      recommendedTtl: result.recommendedTtl,
    };
  }
}

/**
 * Asks the LLM for a response to the given prompt.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} prompt - The prompt to send to the LLM.
 * @param {string} cacheId - The ID of the cache entry.
 */
export async function askLlm(sessionId, prompt, cacheId) {
  const messageHistory = await getChatMessages(sessionId);
  const result = await answerPrompt(
    prompt,
    messageHistory.map((message) => ({
      role: message.isLocal ? "user" : "assistant",
      content: message.message,
    })),
  );

  if (result.canCacheResponse) {
    logger.debug(`Cacheable prompt found: ${prompt}`);
    logger.debug(`Inferred prompt: ${result.inferredPrompt}`);
    logger.debug(`Response: ${result.response}`);
    await cachePrompt(cacheId, {
      originalPrompt: prompt,
      inferredPrompt: result.inferredPrompt,
      response: result.response,
      cacheJustification: result.cacheJustification,
      recommendedTtl: result.recommendedTtl,
    });
  }

  return result.response;
}

/**
 * Handles incoming messages from the client.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} prompt - The message received from the client.
 * @param {boolean} [noCache=false] - If true, skips the cache check and always generates a new response.
 */
export async function handleMessage(send, sessionId, prompt, noCache = false) {
  await createIndexIfNotExists();
  const userMessageId = `chat-user-${randomBytes(20)}`;
  const botId = `chat-bot-${randomBytes(20)}`;
  const userMessage = {
    id: userMessageId,
    message: prompt,
    isLocal: true,
  };

  const response = {
    id: botId,
    message: "...",
    isLocal: false,
  };
  let botResponseSent = false;
  try {
    const messageId = await addChatMessage(sessionId, userMessage);

    logger.debug(`Sending user message: ${messageId}`);
    send(
      view.renderMessage({
        ...userMessage,
        id: messageId,
      }),
    );

    logger.debug(`Sending initial response: ${response.id}`);
    send(
      view.renderMessage({
        ...response,
        showRefresh: false,
      }),
    );
    botResponseSent = true;

    if (!noCache) {
      const cacheResult = await findSimilarPrompt(prompt);

      if (cacheResult) {
        response.message = cacheResult.response;
      }
    }

    if (response.message === "...") {
      response.message = await askLlm(sessionId, prompt, botId);
    }

    response.id = await addChatMessage(sessionId, response);

    logger.debug(`Replacing ${botId} response with: ${response.id}`);
    const replacement = view.renderMessage({
      ...response,
      replaceId: botId,
    });

    send(replacement);

    return replacement;
  } catch (error) {
    logger.error(`Error handling message:`, error);

    const message = {
      id: botId,
      message: "An error occurred while processing your message.",
      isLocal: false,
    };

    if (botResponseSent) {
      send(
        view.renderMessage({
          replaceId: botId,
          ...message,
          showRefresh: false,
        }),
      );
    } else {
      send(
        view.renderMessage({
          ...message,
          showRefresh: false,
        }),
      );
    }
  }
}

/**
 * Regenerates a message in the chat session.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} entryId - The ID of the message entry to regenerate.
 */
export async function regenerateMessage(send, sessionId, entryId) {
  logger.debug(`Regenerating message: ${entryId} for session: ${sessionId}`);

  const botId = `chat-bot-${randomBytes(20)}`;
  const promptMessage = await getPreviousChatMessage(sessionId, entryId);
  const responseMessage = await getChatMessage(sessionId, entryId);

  if (!(promptMessage && responseMessage)) {
    logger.warn(`No previous message found for ID: ${entryId}`);
    const response = view.renderMessage({
      replaceId: entryId,
      id: entryId,
      message: "No previous message found to regenerate.",
      isLocal: false,
    });
    send(response);
    return response;
  }

  try {
    logger.debug(`Replacing response: ${entryId}`);

    send(
      view.renderMessage({
        replaceId: entryId,
        id: entryId,
        message: "...",
        isLocal: false,
        showRefresh: false,
      }),
    );

    const text = await askLlm(sessionId, promptMessage.message, botId);

    await changeChatMessage(responseMessage.messageKey, text);
    const response = view.renderMessage({
      replaceId: entryId,
      id: entryId,
      message: text,
      isLocal: false,
    });
    send(response);

    return response;
  } catch (error) {
    logger.error("Error regenerating message:", error);
    const response = view.renderMessage({
      replaceId: entryId,
      id: entryId,
      message: "An error occurred while regenerating the message.",
      isLocal: false,
    });
    send(response);
    return response;
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
      view.renderMessage({
        id: message.entryId,
        message: message.message,
        isLocal: message.isLocal,
      }),
    );
  }
}
