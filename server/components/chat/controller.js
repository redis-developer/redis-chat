import { answerPrompt } from "../../services/ai/ai";
import { randomBytes } from "../../utils/crypto";
import logger from "../../utils/log";
import * as store from "./store";
import * as view from "./view";

/**
 * Clears all messages for a given session.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session to clear messages for.
 * @param {string} chatId - The ID of the chat session to clear messages for.
 */
export async function clearMessages(send, sessionId, chatId) {
  try {
    logger.info(`Clearing messages for session \`${sessionId}\``, {
      sessionId,
    });
    await store.deleteChatMessages(sessionId, chatId);
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
    const { total, documents } = await store.vss(prompt, {
      sessionId,
      globalMemory: true,
      longTermMemory: true,
    });

    logger.info(`Found ${total ?? 0} result(s) in the semantic cache`, {
      sessionId,
    });
    if (total > 0) {
      const result = documents[0].value;

      return {
        response: result.response,
        embedding: result.embedding,
        originalPrompt: result.originalPrompt,
        inferredQuestion: result.inferredQuestion,
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
 * @param {string} chatId - The ID of the chat session.
 * @param {string} prompt - The prompt to send to the LLM.
 * @param {string} cacheId - The ID of the cache entry.
 */
export async function askLlm(sessionId, chatId, prompt, cacheId) {
  try {
    const messageHistory = await store.getChatMessages(sessionId, chatId);
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
      async ({ question, globalMemory, longTermMemory }) => {
        if (longTermMemory) {
          logger.info(`Searching long-term memory for question: ${question}`, {
            sessionId,
          });
        } else {
          logger.info(`Searching global memory for question: ${question}`, {
            sessionId,
          });
        }

        const results = await store.vss(question, {
          globalMemory,
          longTermMemory,
          sessionId,
        });

        if (longTermMemory) {
          logger.info(
            `Found ${results.total ?? 0} result(s) in long-term memory`,
            {
              sessionId,
            },
          );
        } else {
          logger.info(
            `Found ${results.total ?? 0} result(s) in global memory`,
            {
              sessionId,
            },
          );
        }

        if (results.total > 0) {
          return results.documents[0].value.response;
        }

        return "No relevant information found in memory store.";
      },
      messageHistory.map((message) => ({
        role: message.isLocal ? "user" : "assistant",
        content: message.message,
      })),
    );

    if (result.storeInGlobalMemory || result.storeInLongTermMemory) {
      const globalMemory = result.storeInGlobalMemory;
      const longTermMemory = result.storeInLongTermMemory;
      const cacheJustification = longTermMemory
        ? result.longTermMemoryJustification
        : result.globalMemoryJustification;
      const logMeta = {
        sessionId,
        originalPrompt: prompt,
        location: longTermMemory ? "long-term memory" : "global memory",
        inferredQuestion: result.inferredQuestion,
        justification: result.longTermMemoryJustification,
        recommendedTtl: result.recommendedTtl,
      };

      const existing = await store.vss(result.inferredQuestion, {
        globalMemory,
        longTermMemory,
        sessionId,
      });

      if (result.storeInLongTermMemory) {
        logger.info(
          `LLM wants to store "${prompt}" as "${result.inferredQuestion}" in long-term memory`,
          logMeta,
        );
      } else if (result.storeInGlobalMemory) {
        logger.info(
          `LLM wants to store "${prompt}" as "${result.inferredQuestion}" in global memory`,
          logMeta,
        );
      }

      if (existing.total > 0) {
        logger.info(
          `Found ${existing.total} existing result(s) in memory for "${result.inferredQuestion}", skipping storing additional values.`,
          {
            sessionId,
          },
        );
      } else {
        await store.cachePrompt(
          cacheId,
          {
            originalPrompt: prompt,
            inferredQuestion: result.inferredQuestion,
            response: result.response,
            cacheJustification,
            recommendedTtl: result.recommendedTtl,
          },
          {
            sessionId,
            globalMemory,
            longTermMemory,
          },
        );
      }
    } else {
      logger.info(`Unable to store "${result.inferredQuestion}" in memory`, {
        sessionId,
        originalPrompt: prompt,
        inferredQuestion: result.inferredQuestion,
        longTermMemoryJustification: result.longTermMemoryJustification,
        globalMemoryJustification: result.globalMemoryJustification,
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
 * @param {Object} params - Parameters containing sessionId and prompt.
 * @param {string} params.sessionId - The ID of the chat session.
 * @param {string} params.chatId - The ID of the chat for the message
 * @param {string} params.message - The message received from the client.
 * @param {boolean} [noCache=false] - If true, skips the cache check and always generates a new response.
 */
export async function handleMessage(
  send,
  { sessionId, chatId, message },
  noCache = false,
) {
  let botResponseSent = false;
  const userMessageId = `user-${randomBytes(20)}`;
  const botId = `bot-${randomBytes(20)}`;
  const userMessage = {
    id: userMessageId,
    message: message,
    isLocal: true,
  };

  const response = {
    id: botId,
    message: "...",
    isLocal: false,
  };

  try {
    await store.createIndexIfNotExists(sessionId);

    const messageId = await store.addChatMessage(
      sessionId,
      chatId,
      userMessage,
    );

    logger.info(`User message added to stream for session \`${sessionId}\``, {
      sessionId,
    });

    send(
      view.renderMessage({
        ...userMessage,
        id: messageId,
      }),
    );

    send(view.renderMessage(response));
    botResponseSent = true;

    if (!noCache) {
      const cacheResult = await findSimilarPrompt(message, sessionId);

      if (cacheResult) {
        response.message = cacheResult.response;
      }
    }

    if (response.message === "...") {
      response.message = await askLlm(sessionId, chatId, message, botId);
    }

    response.id = await store.addChatMessage(sessionId, chatId, response);

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
        }),
      );
    } else {
      send(view.renderMessage(message));
    }
  }
}

/**
 * Regenerates a message in the chat session.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} chatId - The ID of the chat session.
 * @param {string} entryId - The ID of the message entry to regenerate.
 */
export async function regenerateMessage(send, sessionId, chatId, entryId) {
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
      chatId,
      entryId,
    );
    const responseMessage = await store.getChatMessage(
      sessionId,
      chatId,
      entryId,
    );

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
      }),
    );

    const text = await askLlm(sessionId, chatId, promptMessage.message, botId);

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
 * Creates a new chat session.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId
 *
 * @return {Promise<string>} - The ID of the newly created chat session.
 */
export async function newChat(send, sessionId) {
  const newChatId = `chat-${randomBytes(20)}`;
  logger.info(
    `Creating new chat session \`${newChatId}\` for session \`${sessionId}\``,
    {
      sessionId,
    },
  );

  const chats = [
    {
      chatId: newChatId,
      message: "New chat",
    },
    ...(await store.getAllChats(sessionId)),
  ];

  send(
    view.renderChats({
      chats,
      currentChatId: newChatId,
    }),
  );

  send(
    view.clearMessages({
      placeholder: false,
    }),
  );

  return newChatId;
}

/**
 * Initializes the chat by sending all previous messages to the WebSocket client.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} chatId - The ID of the chat to initialize.
 */
export async function initializeChat(send, sessionId, chatId) {
  try {
    logger.info(`Initializing chat for session \`${sessionId}\``, {
      sessionId,
    });

    send(
      view.clearMessages({
        placeholder: false,
      }),
    );

    const messages = await store.getChatMessages(sessionId, chatId);

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
      error,
      sessionId,
    });
  }
}

/**
 * Retrieves the chat history for a given session.
 *
 * @param {string} sessionId
 */
export async function getChatsHistory(sessionId) {
  try {
    logger.info(`Initializing chat history for session \`${sessionId}\``, {
      sessionId,
    });

    return store.getAllChats(sessionId);
  } catch (error) {
    logger.error(
      `Failed to initialize chat history for session \`${sessionId}\`:`,
      {
        error,
        sessionId,
      },
    );
  }
}
