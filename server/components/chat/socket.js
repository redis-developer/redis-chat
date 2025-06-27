import { WebSocketServer } from "ws";
import logger, { logWst } from "../../utils/log";
import { randomUlid } from "../../utils/uid";
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
  session(req, /** @type {any} */ ({}), async () => {
    const sessionId = req.session.id;

    if (!sessionId) {
      return;
    }

    /**
     * Sends a response to the WebSocket client.
     *
     * @param {string} response - The response message to send.
     */
    const send = (response) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(response);
      } else {
        logger.warn("WebSocket is not open, cannot send message", {
          sessionId: req.session.id,
        });
      }
    };

    logger.debug("Socket connection established", {
      sessionId: req.session.id,
    });

    let currentChatId = /** @type {string} */ (
      /** @type {any} */ (req.session).currentChatId
    );

    if (!currentChatId) {
      currentChatId = `chat-${randomUlid()}`;

      // @ts-ignore
      req.session.currentChatId = currentChatId;
      req.session.save();

      await ctrl.newChat(send, sessionId, currentChatId);
    }

    ws.on("error", logger.error);
    ws.on("message", async (data) => {
      const form = JSON.parse(data.toString());

      switch (form.cmd) {
        case "new_message":
          await ctrl.handleMessage(send, {
            sessionId,
            chatId: currentChatId,
            message: form.message,
          });
          break;
        case "new_session":
          await ctrl.clearMessages(send, sessionId, currentChatId);
          logWst.removeSession(sessionId);
          req.session.destroy(function (err) {
            if (err) {
              logger.error("Failed to regenerate session", { error: err });
              return;
            }
          });
          break;
        case "new_chat":
          currentChatId = `chat-${randomUlid()}`;

          // @ts-ignore
          req.session.currentChatId = currentChatId;
          req.session.save();

          await ctrl.newChat(send, sessionId, currentChatId);
          break;
        case "switch_chat":
          if (!form.chatId) {
            logger.warn("No chatId provided for switch_chat command", {
              sessionId,
            });
            return;
          }
          if (form.chatId === currentChatId) {
            logger.warn("Attempted to switch to the current chat", {
              sessionId,
              chatId: form.chatId,
            });
            return;
          }

          currentChatId = form.chatId;
          // @ts-ignore
          req.session.currentChatId = currentChatId;
          req.session.save();

          await ctrl.switchChat(send, sessionId, currentChatId);
          break;
        case "clear_all":
          await ctrl.clearMemory(send, sessionId);
          break;
        default:
          logger.warn("Unknown command received", { cmd: form.cmd, sessionId });
          return;
      }
    });

    await ctrl.initializeChat(send, sessionId, currentChatId);
  });
}

wss.on("connection", onConnection);
