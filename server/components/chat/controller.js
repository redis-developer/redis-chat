import { answerPrompt, shouldCache } from "../../utils/ai.js";
import { cachePrompt, addChatMessage, createIndexIfNotExists, getChatMessages, vss } from "./store.js";
import { renderMessage } from "./view.js";

export async function initialize() {
  await createIndexIfNotExists();
}

async function checkCache(prompt) {
  const { total, documents } = await vss(prompt);

  console.log(`Found ${total ?? 0} results in the VSS`);
  if (total > 0) {
    const result = documents[0].value;
    console.log(result);
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
  if (ws.readyState !== ws.OPEN) {
    return;
  }

  const userMessage = {
    message,
    isLocal: true,
  };

  ws.send(
    renderMessage({
      message,
      isLocal: true,
    }),
  );
  await addChatMessage(sessionId, userMessage);


  const response = {
    message: "",
    isLocal: false,
  };

  const cacheResult = await checkCache(message);

  if (cacheResult) {
    response.message = cacheResult.response;
  }

  if (!response.message) {
    const result = await answerPrompt(message);
    response.message = result.text;

    if (result.shouldCacheResult) {
      await cachePrompt({
        prompt: message,
        inferredPrompt: result.inferredPrompt,
        response: response.message,
        cacheJustification: result.cacheJustification,
      });
    }
  }

  await addChatMessage(sessionId, response);

  ws.send(renderMessage(response));
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
