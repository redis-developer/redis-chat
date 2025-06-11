import { getChatMessages } from "./store.js";
import { renderMessage } from "./view.js";


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
    message: await generateResponse(message),
    isLocal: false,
  };

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
