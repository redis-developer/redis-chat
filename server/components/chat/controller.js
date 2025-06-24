import { answerPrompt } from "../../services/ai";
import { randomBytes } from "../../utils/crypto";
import logger from "../../utils/log";
import * as store from "./store";
import * as view from "./view";

/**
 * Clears all messages for a given session.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session to clear messages for.
 */
export async function clearMessages(send, sessionId) {
  try {
    logger.info(`Clearing messages for session \`${sessionId}\``, {
      sessionId,
    });
    await store.deleteChatMessages(sessionId);
    send(view.clearMessages());
  } catch (error) {
    logger.error(`Failed to delete messages for session ${sessionId}:`, {
      error,
      sessionId,
    });
    throw error;
  }
}

/**
 * Clears the entire cache.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 */
export async function clearCache(send, sessionId) {
  try {
    logger.info("Clearing Redis", {
      sessionId,
    });
    await store.deleteKeys();
    send(view.clearMessages());
  } catch (error) {
    logger.error("Failed to clear cache:", {
      error,
      sessionId,
    });
    throw error;
  }
}

/**
 * Checks the cache for a response to the given prompt.
 * If a cached response is found, it returns the response along with
 * the inferred prompt and cache justification.
 *
 * @param {string} prompt - The prompt to check in the cache.
 * @param {string} sessionId - The ID of the chat session.
 *
 * @return {Promise<import("./store").Chat | undefined>} - An object containing the cached response and metadata,
 */
async function findSimilarPrompt(prompt, sessionId) {
  try {
    const { total, documents } = await store.vss(prompt);

    logger.info(`Found ${total ?? 0} result(s) in the semantic cache`, {
      sessionId,
    });
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
  } catch (error) {
    logger.error("Error in vss:", {
      error,
      sessionId,
    });
    throw error;
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
  try {
    const messageHistory = await store.getChatMessages(sessionId);
    logger.info(
      `Retrieved ${messageHistory.length} messages from session \`${sessionId}\``,
      {
        sessionId,
      },
    );

    logger.info(`Asking the LLM: ${prompt}`, {
      sessionId,
    });
    const result = await answerPrompt(
      prompt,
      messageHistory.map((message) => ({
        role: message.isLocal ? "user" : "assistant",
        content: message.message,
      })),
    );

    if (result.canCacheResponse) {
      logger.info(`Cacheable prompt found: ${prompt}`, {
        sessionId,
        inferredPrompt: result.inferredPrompt,
        cacheJustification: result.cacheJustification,
        recommendedTtl: result.recommendedTtl,
      });

      await store.cachePrompt(cacheId, {
        originalPrompt: prompt,
        inferredPrompt: result.inferredPrompt,
        response: result.response,
        cacheJustification: result.cacheJustification,
        recommendedTtl: result.recommendedTtl,
      });
    } else {
      logger.info(`Prompt unable to be cached: ${prompt}`, {
        sessionId,
        cacheJustification: result.cacheJustification,
      });
    }

    return result.response;
  } catch (error) {
    logger.error(`Failed to ask LLM \`${prompt}\`:`, {
      error,
      sessionId,
      prompt,
    });
    throw error;
  }
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
  let botResponseSent = false;
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

  try {
    await store.createIndexIfNotExists();

    const messageId = await store.addChatMessage(sessionId, userMessage);

    logger.info(`User message added to stream for session \`${sessionId}\``, {
      sessionId,
    });

    send(
      view.renderMessage({
        ...userMessage,
        id: messageId,
      }),
    );

    send(
      view.renderMessage({
        ...response,
        showRefresh: false,
      }),
    );
    botResponseSent = true;

    if (!noCache) {
      const cacheResult = await findSimilarPrompt(prompt, sessionId);

      if (cacheResult) {
        response.message = cacheResult.response;
      }
    }

    if (response.message === "...") {
      response.message = await askLlm(sessionId, prompt, botId);
    }

    response.id = await store.addChatMessage(sessionId, response);

    logger.info(`Bot message added to stream for session \`${sessionId}\``, {
      sessionId,
    });

    const replacement = view.renderMessage({
      ...response,
      replaceId: botId,
    });

    send(replacement);

    return replacement;
  } catch (error) {
    logger.error(`Error handling message:`, {
      error,
      sessionId,
    });

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
  logger.info(
    `Regenerating message \`${entryId}\` for session \`${sessionId}\``,
    {
      sessionId,
    },
  );

  const botId = `chat-bot-${randomBytes(20)}`;
  try {
    const promptMessage = await store.getPreviousChatMessage(
      sessionId,
      entryId,
    );
    const responseMessage = await store.getChatMessage(sessionId, entryId);

    if (!(promptMessage && responseMessage)) {
      logger.warn(`No previous message found for ID: ${entryId}`, {
        sessionId,
      });

      const response = view.renderMessage({
        replaceId: entryId,
        id: entryId,
        message: "No previous message found to regenerate.",
        isLocal: false,
      });
      send(response);
      return response;
    }

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

    logger.info(`Replacing ${responseMessage.messageKey} with ${text}`, {
      sessionId,
    });

    await store.changeChatMessage(responseMessage.messageKey, text);
    const response = view.renderMessage({
      replaceId: entryId,
      id: entryId,
      message: text,
      isLocal: false,
    });
    send(response);

    return response;
  } catch (error) {
    logger.error("Error regenerating message:", {
      error,
      sessionId,
    });
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
  try {
    logger.info(`Initializing chat for session \`${sessionId}\``, {
      sessionId,
    });
    const messages = await store.getChatMessages(sessionId);

    for (const message of messages) {
      send(
        view.renderMessage({
          id: message.entryId,
          message: message.message,
          isLocal: message.isLocal,
        }),
      );
    }
  } catch (error) {
    logger.error(`Failed to initialize chat for session \`${sessionId}\`:`, {
      sessionId,
    });
  }
}
