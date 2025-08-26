import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { Request } from "express";
import logger, { logWst } from "../../utils/log";
import { randomUlid } from "../../utils/uid";
import session from "../../utils/session";
import * as ctrl from "./controller";
import * as view from "./view";

export const wss = new WebSocketServer({ noServer: true });

/**
 * Handles WebSocket connections and messages.
 */
function onConnection(ws: WebSocket, req: Request) {
  session(req, {} as any, async () => {
    const userId = req.session.id;

    if (!userId) {
      return;
    }

    /**
     * Sends a response to the WebSocket client.
     */
    const send = (response: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(response);
      } else {
        logger.warn("WebSocket is not open, cannot send message", {
          userId: req.session.id,
        });
      }
    };

    logger.debug("Chat websocket connection established", {
      userId: req.session.id,
    });

    let currentChatId: string | undefined;

    ws.on("error", logger.error);
    ws.on("message", async (data) => {
      const form = JSON.parse(data.toString());

      switch (form.cmd) {
        case "new_message":
          currentChatId = await ctrl.processChat(send, {
            userId,
            chatId: currentChatId,
            message: form.message,
          });

          // @ts-ignore
          req.session.currentChatId = currentChatId;
          req.session.save();
          break;
        case "new_user":
          logWst.removeUser(userId);
          req.session.destroy(function (err) {
            if (err) {
              logger.error("Failed to regenerate session", { error: err });
              return;
            }
          });
          break;
        case "new_chat":
          currentChatId = `chat-${randomUlid()}`;

          currentChatId = await ctrl.newChat(send, userId);

          // @ts-ignore
          req.session.currentChatId = currentChatId;
          req.session.save();
          break;
        case "switch_chat":
          if (!form.chatId) {
            logger.warn("No chatId provided for switch_chat command", {
              userId,
            });
            return;
          }
          if (form.chatId === currentChatId) {
            return;
          }

          currentChatId = form.chatId;
          // @ts-ignore
          req.session.currentChatId = currentChatId;
          req.session.save();

          await ctrl.switchChat(send, userId, currentChatId!);
          break;
        case "clear_all":
          await ctrl.clearMemory(send, userId);
          logWst.removeUser(userId);
          req.session.destroy(function (err) {
            if (err) {
              logger.error("Failed to regenerate session", { error: err });
              return;
            }
          });
          break;
        default:
          logger.warn("Unknown command received", { cmd: form.cmd, userId });
          return;
      }
    });

    if (currentChatId) {
      await ctrl.initializeChat(send, userId, currentChatId);
    }
  });
}

wss.on("connection", onConnection);
