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
 */
async function checkCache(prompt) {
  const { total, documents } = await vss(prompt);

  logger.debug(`Found ${total ?? 0} results in the VSS`);
  if (total > 0) {
    const result = documents[0].value;
    return {
      response: result.response,
      inferredPrompt: result.inferredPrompt,
      cacheJustification: result.cacheJustification,
    };
  }
}

/**
 * Handles incoming messages from the WebSocket client.
 *
 * @param {WebSocket} ws - The WebSocket connection to the client.
 * @param {string} sessionId - The ID of the chat session.
 * @param {string} message - The message received from the client.
 */
async function handleMessage(ws, sessionId, message) {
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
  let userResponseSent = false;
  let botResponseSent = false;
  try {
    if (ws.readyState !== ws.OPEN) {
      return;
    }

    await addChatMessage(sessionId, userMessage);

    logger.debug(`Sending user message: ${userMessage.id}`);
    ws.send(renderMessage(userMessage));
    userResponseSent = true;

    logger.debug(`Sending initial response: ${response.id}`);
    ws.send(renderMessage(response));
    botResponseSent = true;

    const cacheResult = await checkCache(message);

    if (cacheResult) {
      response.message = cacheResult.response;
    }

    if (response.message === "...") {
      const result = await answerPrompt(message);
      response.message = result.text;
      logger.debug(response.message);

      if (result.shouldCacheResult) {
        logger.debug(`Cacheable prompt found: ${message}`);
        logger.debug(`Inferred prompt: ${result.inferredPrompt}`);
        await cachePrompt(response.id, {
          prompt: message,
          inferredPrompt: result.inferredPrompt,
          response: response.message,
          cacheJustification: result.cacheJustification,
        });
      }
    }

    await addChatMessage(sessionId, response);

    logger.debug(`Replacing response: ${response.id}`);
    ws.send(replaceMessage(response));
  } catch (error) {
    logger.error("Error handling message:", error.message);
    const message = {
      id: botId,
      message: "An error occurred while processing your message.",
      isLocal: false,
    };

    if (botResponseSent) {
      ws.send(replaceMessage(message));
    } else {
      ws.send(renderMessage(message));
    }
  }
}

/**
 * Initializes the chat by sending all previous messages to the WebSocket client.
 *
 * @param {WebSocket} ws - The WebSocket connection to the client.
 * @param {string} sessionId - The ID of the chat session.
 */
export async function initializeChat(ws, sessionId) {
  const messages = await getChatMessages(sessionId);

  for (const message of messages) {
    ws.send(
      renderMessage({
        id: message.id,
        message: message.message,
        isLocal: message.isLocal,
      }),
    );
  }

  ws.on("error", logger.error);
  ws.on("message", (data) => {
    const { message } = JSON.parse(data);
    handleMessage(ws, sessionId, message);
  });
}
