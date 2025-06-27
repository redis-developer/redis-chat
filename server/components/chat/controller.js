import { answerPrompt } from "../../services/ai/ai";
import { randomUlid } from "../../utils/uid";
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
export async function clearChat(send, sessionId, chatId) {
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
 * Clears the entire store.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 */
export async function clearMemory(send, sessionId) {
  try {
    logger.info("Clearing Redis", {
      sessionId,
    });
    await store.deleteAll();
    send(view.clearMessages());
  } catch (error) {
    logger.error("Failed to clear memory:", {
      error,
      sessionId,
    });
    throw error;
  }
}

/**
 * Checks memory for a response to the given question.
 * If a response is found, it returns the response along with
 * the inferred question and reasoning.
 *
 * @param {string} question - The question to check in memory.
 * @param {string} sessionId - The ID of the chat session.
 *
 * @return {Promise<import("./store").Chat | undefined>} - An object containing the stored response and metadata,
 */
async function searchMemory(question, sessionId) {
  try {
    logger.info(`Searching semantic memory for question: ${question}`, {
      sessionId,
    });
    const { total, documents } = await store.search(question, {
      sessionId,
      semanticMemory: true,
    });

    logger.info(`Found ${total ?? 0} result(s) in semantic memory`, {
      sessionId,
    });
    if (total > 0) {
      const result = documents[0].value;

      return {
        response: result.response,
        embedding: result.embedding,
        originalQuestion: result.originalQuestion,
        inferredQuestion: result.inferredQuestion,
        reasoning: result.reasoning,
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
 * @param {string} question - The question to send to the LLM.
 * @param {string} storeId - The ID of the stored entry.
 */
export async function ask(sessionId, chatId, question, storeId) {
  try {
    const messageHistory = await store.getChatMessages(sessionId, chatId);
    logger.info(
      `Retrieved ${messageHistory.length} messages from session \`${sessionId}\``,
      {
        sessionId,
      },
    );

    logger.info(`Asking the LLM: ${question}`, {
      sessionId,
    });
    const result = await answerPrompt(
      question,
      async ({ question: q }) => {
        logger.info(`Searching user memory for question: ${q}`, {
          sessionId,
        });

        const results = await store.search(q, {
          userMemory: true,
          sessionId,
        });

        logger.info(`Found ${results.total ?? 0} result(s) in user memory`, {
          sessionId,
        });

        if (results.total > 0) {
          return results.documents[0].value.response;
        }

        return "No relevant information found in user memory store.";
      },
      messageHistory.map((message) => ({
        role: message.isLocal ? "user" : "assistant",
        content: message.message,
      })),
    );

    logger.info(`LLM response received for question: ${question}`, {
      sessionId,
    });

    if (result.storeInSemanticMemory || result.storeInUserMemory) {
      const semanticMemory = result.storeInSemanticMemory;
      const userMemory = result.storeInUserMemory;
      const reasoning = userMemory
        ? result.userMemoryReasoning
        : result.semanticMemoryReasoning;
      const logMeta = {
        sessionId,
        originalQuestion: question,
        location: userMemory ? "user memory" : "semantic memory",
        inferredQuestion: result.inferredQuestion,
        reasoning: result.userMemoryReasoning,
        recommendedTtl: result.recommendedTtl,
      };

      if (userMemory) {
        logger.info(
          `LLM wants to store "${question}" as "${result.inferredQuestion}" in user memory`,
          logMeta,
        );
      } else if (semanticMemory) {
        logger.info(
          `LLM wants to store "${question}" as "${result.inferredQuestion}" in semantic memory`,
          logMeta,
        );
      }

      logger.info(
        `Searching memory for existing question "${result.inferredQuestion}"`,
        {
          sessionId,
        },
      );

      const existing = await store.search(result.inferredQuestion, {
        semanticMemory,
        userMemory,
        sessionId,
      });

      if (existing.total > 0) {
        logger.info(
          `Found ${existing.total} existing result(s) in memory for "${result.inferredQuestion}", replacing original value.`,
          {
            sessionId,
          },
        );
        const id = existing.documents[0].id;
        await store.storeQuestion(
          id,
          {
            originalQuestion: question,
            inferredQuestion: result.inferredQuestion,
            response: result.response,
            reasoning,
            recommendedTtl: result.recommendedTtl,
          },
          {
            sessionId,
            semanticMemory,
            userMemory,
          },
        );
      } else {
        logger.info(
          `Existing question not found, storing new question "${result.inferredQuestion}" in memory`,
          {
            sessionId,
          },
        );
        await store.storeQuestion(
          storeId,
          {
            originalQuestion: question,
            inferredQuestion: result.inferredQuestion,
            response: result.response,
            reasoning,
            recommendedTtl: result.recommendedTtl,
          },
          {
            sessionId,
            semanticMemory,
            userMemory,
          },
        );
      }
    } else {
      logger.info(
        `LLM doesn't want to store "${result.inferredQuestion}" in memory`,
        {
          sessionId,
          originalQuestion: question,
          inferredQuestion: result.inferredQuestion,
          userMemoryReasoning: result.userMemoryReasoning,
          semanticMemoryReasoning: result.semanticMemoryReasoning,
        },
      );
    }

    return result.response;
  } catch (error) {
    logger.error(`Failed to ask LLM \`${question}\`:`, {
      error,
      sessionId,
      prompt: question,
    });
    throw error;
  }
}

/**
 * Handles incoming chat messages from the client.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {Object} params - Parameters containing sessionId and prompt.
 * @param {string} params.sessionId - The ID of the chat session.
 * @param {string} params.chatId - The ID of the chat for the message
 * @param {string} params.message - The message received from the client.
 * @param {boolean} [skipMemory=false] - If true, skips the memory check and always generates a new response.
 */
export async function processChat(
  send,
  { sessionId, chatId, message },
  skipMemory = false,
) {
  let botResponseSent = false;
  const userMessageId = `user-${randomUlid()}`;
  const botId = `bot-${randomUlid()}`;
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
    await store.createIndexesIfNotExists();

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

    if (!skipMemory) {
      const memoryResult = await searchMemory(message, sessionId);

      if (memoryResult) {
        response.message = memoryResult.response;
      }
    }

    if (response.message === "...") {
      response.message = await ask(sessionId, chatId, message, botId);
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
 * Creates a new chat session.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId
 * @param {string} newChatId - The ID of the chat session.
 */
export async function newChat(send, sessionId, newChatId) {
  try {
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
        placeholder: true,
      }),
    );
  } catch (error) {
    logger.error(`Failed to create new chat for session \`${sessionId}\`:`, {
      error,
      sessionId,
    });
    throw error;
  }
}

/**
 * Switches the current chat session to a different chat.
 *
 * @param {(message: string) => void} send - Method to send responses to the client.
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} chatId - The ID of the chat to switch to.
 */
export async function switchChat(send, sessionId, chatId) {
  try {
    logger.info(
      `Switching to chat \`${chatId}\` for session \`${sessionId}\``,
      {
        sessionId,
      },
    );

    const chats = await store.getAllChats(sessionId);

    send(
      view.renderChats({
        chats,
        currentChatId: chatId,
      }),
    );

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
    logger.error(`Failed to switch chat for session \`${sessionId}\`:`, {
      error,
      sessionId,
    });
    throw error;
  }
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

    const messages = await store.getChatMessages(sessionId, chatId);
    const placeholder = messages.length === 0;

    send(
      view.clearMessages({
        placeholder,
      }),
    );

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
export async function getAllChats(sessionId) {
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
