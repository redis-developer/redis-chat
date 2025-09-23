import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { Request } from "express";
import logger, { logWst } from "../../utils/log";
import expressSession from "express-session";
import { getSessionParser } from "../../utils/session";
import * as orchestrator from "./controller";

export const wss = new WebSocketServer({ noServer: true });

export type NewChatMessageForm = {
  cmd: "chats/messages/new";
  message: string;
};

export type NewChatForm = {
  cmd: "chats/new";
};

export type SwitchChatForm = {
  cmd: "chats/switch";
  chatId: string;
};

export type NewUserForm = {
  cmd: "users/new";
};

export type ClearDataForm = {
  cmd: "data/clear";
};

export type OpenLogForm = {
  cmd: "logs/open";
};

export type CloseLogForm = {
  cmd: "logs/close";
};

export type MessageForm =
  | NewChatMessageForm
  | NewChatForm
  | SwitchChatForm
  | NewUserForm
  | ClearDataForm;

export type AppSession = Pick<
  expressSession.Session & Partial<expressSession.SessionData>,
  "id" | "save" | "destroy"
> & {
  currentChatId: string;
};

async function initialize() {}

export async function onMessage(
  send: (message: string) => void,
  session: AppSession,
  form: MessageForm,
) {
  const userId = session.id;
  const { currentChatId } = session;
  let newChatId: string | undefined;

  switch (form.cmd) {
    case "chats/messages/new":
      newChatId = await orchestrator.newChatMessage(send, {
        userId,
        chatId: currentChatId,
        message: form.message,
      });

      break;
    case "chats/new":
      newChatId = await orchestrator.newChat(send, userId);

      break;
    case "chats/switch":
      if (!form.chatId) {
        logger.warn("No chatId provided for chats/switch command", {
          userId,
        });
        return;
      }

      if (form.chatId === currentChatId) {
        return;
      }

      newChatId = form.chatId;

      await orchestrator.switchChat(send, userId, form.chatId);
      break;
    case "users/new":
      await orchestrator.clearMemory(send, userId);

      logWst.removeUser(userId);
      session.destroy((err) => {
        if (err) {
          logger.error("Failed to regenerate session", { error: err });
          return;
        }
      });
      break;
    case "data/clear":
      await orchestrator.clearMemory(send, userId);

      // @ts-ignore
      delete session.currentProjectId;
      session.save();
      break;
    default:
      logger.warn("Unknown command received", {
        cmd: (form as any).cmd,
        userId,
      });
      return;
  }

  if (typeof newChatId === "string" && newChatId !== currentChatId) {
    session.currentChatId = newChatId;
    session.save();
  }
}

export async function initializeSocket(
  send: (message: string) => void,
  type: "chat" | "projects",
  session: AppSession,
) {
  const userId = session.id;
  const currentChatId = session.currentChatId;
  let newProjectId: string | undefined;
  let newChatId: string | undefined;

  switch (type) {
    case "chat":
      newChatId = await orchestrator.initializeChat(
        send,
        userId,
        currentChatId,
      );

      break;
    default:
      logger.warn("Unknown WebSocket type", { type, userId });
      return;
  }

  if (typeof newChatId === "string" && newChatId !== currentChatId) {
    session.currentChatId = newChatId;
    session.save();
  }
}

/**
 * Handles WebSocket connections and messages.
 */
async function onConnection(
  ws: WebSocket,
  req: Request,
  type: "chat" | "projects",
) {
  await initialize();
  const session = await getSessionParser();
  session(req, {} as any, async () => {
    await initialize();
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

    logger.debug("Projects websocket connection established", {
      userId: req.session.id,
    });

    void initializeSocket(send, type, req.session as unknown as AppSession);
    ws.on("error", logger.error);
    ws.on("message", async (data) => {
      void onMessage(
        send,
        req.session as unknown as AppSession,
        JSON.parse(data.toString()) as MessageForm,
      );
    });
  });
}

wss.on("connection", onConnection);
