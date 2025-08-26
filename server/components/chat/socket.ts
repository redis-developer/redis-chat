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

    let currentSessionId: string | undefined;

    ws.on("error", logger.error);
    ws.on("message", async (data) => {
      const form = JSON.parse(data.toString());

      switch (form.cmd) {
        case "new_message":
          currentSessionId = await ctrl.processChat(send, {
            userId,
            sessionId: currentSessionId,
            message: form.message,
          });

          if (currentSessionId) {
            await ctrl.summarizeChat(userId, currentSessionId);
          }

          // @ts-ignore
          req.session.currentSessionId = currentSessionId;
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
          currentSessionId = `chat-${randomUlid()}`;

          currentSessionId = await ctrl.newChat(send, userId);

          // @ts-ignore
          req.session.currentSessionId = currentSessionId;
          req.session.save();
          break;
        case "switch_chat":
          if (!form.sessionId) {
            logger.warn("No sessionId provided for switch_chat command", {
              userId,
            });
            return;
          }
          if (form.sessionId === currentSessionId) {
            logger.warn("Attempted to switch to the current chat", {
              userId,
              sessionId: form.sessionId,
            });
            return;
          }

          currentSessionId = form.sessionId;
          // @ts-ignore
          req.session.currentSessionId = currentSessionId;
          req.session.save();

          await ctrl.switchChat(send, userId, currentSessionId!);
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

    if (currentSessionId) {
      await ctrl.initializeChat(send, userId, currentSessionId);
    }
  });
}

wss.on("connection", onConnection);
