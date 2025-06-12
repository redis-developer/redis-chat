import { answerPrompt } from "../../utils/ai.js";
import { randomBytes } from "../../utils/crypto.js";
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

async function checkCache(prompt) {
  const { total, documents } = await vss(prompt);

  console.log(`Found ${total ?? 0} results in the VSS`);
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
  try {
    if (ws.readyState !== ws.OPEN) {
      return;
    }

    const userMessage = {
      id: `chat-user-${randomBytes(20)}`,
      message,
      isLocal: true,
    };

    await addChatMessage(sessionId, userMessage);
    console.log(`Sending user message: ${userMessage.id}`);
    ws.send(renderMessage(userMessage));

    const response = {
      id: `chat-bot-${randomBytes(20)}`,
      message: "...",
      isLocal: false,
    };
    console.log(`Sending initial response: ${response.id}`);
    ws.send(renderMessage(response));

    const cacheResult = await checkCache(message);

    if (cacheResult) {
      response.message = cacheResult.response;
    }

    if (response.message === "...") {
      const result = await answerPrompt(message);
      response.message = result.text;
      console.log(response.message);

      if (result.shouldCacheResult) {
        console.log(`Cacheable prompt found: ${message}`);
        console.log(`Inferred prompt: ${result.inferredPrompt}`);
        await cachePrompt(response.id, {
          prompt: message,
          inferredPrompt: result.inferredPrompt,
          response: response.message,
          cacheJustification: result.cacheJustification,
        });
      }
    }

    await addChatMessage(sessionId, response);

    console.log(`Replacing response: ${response.id}`);
    ws.send(replaceMessage(response));
  } catch (error) {
    console.error("Error handling message:", error);
    ws.send(
      JSON.stringify({
        error: "An error occurred while processing your message.",
      }),
    );
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

  ws.on("error", console.error);
  ws.on("message", (data) => {
    const { message } = JSON.parse(data);
    handleMessage(ws, sessionId, message);
  });
}
