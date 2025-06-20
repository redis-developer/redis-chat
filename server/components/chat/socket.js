import { WebSocketServer } from "ws";
import logger from "../../utils/log";
import session from "../../utils/session";
import * as ctrl from "./controller";

export const wss = new WebSocketServer({ noServer: true });

/**
 * Handles WebSocket connections and messages.
 *
 * @param {import("ws").WebSocket} ws - The WebSocket connection.
 * @param {import("express").Request} req - The HTTP request object.
 */
function onConnection(ws, req) {
  /**
   * Sends a response to the WebSocket client.
   *
   * @param {string} response - The response message to send.
   */
  const send = (response) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(response);
    } else {
      logger.warn("WebSocket is not open, cannot send message");
    }
  };

  logger.debug("Socket connection established");

  session(req, /** @type {any} */ ({}), async () => {
    const sessionId = req.session.id;

    if (!sessionId) {
      return;
    }

    ws.on("error", logger.error);
    ws.on("message", async (data) => {
      console.log(data);
      console.log(data.toString());
      const { cmd, id, message } = JSON.parse(data.toString());

      if (cmd === "prompt") {
        await ctrl.handleMessage(send, sessionId, message);
      } else if (cmd === "regenerate") {
        await ctrl.regenerateMessage(send, sessionId, id);
      } else if (cmd === "clear_session") {
        await ctrl.clearMessages(send, sessionId);
      } else if (cmd === "clear_all") {
        await ctrl.clearCache(send);
      }
    });

    await ctrl.initializeChat(send, sessionId);
  });
}

wss.on("connection", onConnection);
