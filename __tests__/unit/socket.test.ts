import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockNewChatMessage = mock(() => Promise.resolve("new-chat-id"));
const mockNewChat = mock(() => Promise.resolve("new-chat-id"));
const mockSwitchChat = mock(() => Promise.resolve());
const mockClearMemory = mock(() => Promise.resolve());
const mockInitializeChat = mock(() => Promise.resolve("init-chat-id"));
const mockClearChat = mock(() => Promise.resolve());

mock.module("../../server/components/orchestrator/controller", () => ({
  newChatMessage: mockNewChatMessage,
  newChat: mockNewChat,
  switchChat: mockSwitchChat,
  clearMemory: mockClearMemory,
  initializeChat: mockInitializeChat,
  clearChat: mockClearChat,
}));

mock.module("../../server/utils/log", () => {
  const warn = mock();
  const error = mock();
  const debug = mock();
  const info = mock();
  return {
    default: { warn, error, debug, info },
    logWst: { removeUser: mock() },
    logWss: {},
  };
});

import { onMessage, initializeSocket } from "../../server/components/orchestrator/socket";
import type { AppSession } from "../../server/components/orchestrator/socket";

function createMockSession(overrides?: Partial<AppSession>): AppSession {
  return {
    id: "session-1",
    currentChatId: "current-chat",
    save: mock(),
    destroy: mock((cb: (err?: Error) => void) => cb()),
    ...overrides,
  } as unknown as AppSession;
}

describe("socket", () => {
  const send = mock();

  beforeEach(() => {
    send.mockReset();
    mockNewChatMessage.mockReset();
    mockNewChat.mockReset();
    mockSwitchChat.mockReset();
    mockClearMemory.mockReset();
    mockInitializeChat.mockReset();
    mockNewChatMessage.mockResolvedValue("new-chat-id");
    mockNewChat.mockResolvedValue("new-chat-id");
    mockInitializeChat.mockResolvedValue("init-chat-id");
  });

  describe("onMessage", () => {
    test("chats/messages/new calls newChatMessage and updates session", async () => {
      const session = createMockSession();
      await onMessage(send, session, {
        cmd: "chats/messages/new",
        message: "Hello",
      });

      expect(mockNewChatMessage).toHaveBeenCalledTimes(1);
      const callArgs = mockNewChatMessage.mock.calls[0];
      expect(callArgs[0]).toBe(send);
      expect(callArgs[1]).toMatchObject({
        userId: "session-1",
        chatId: "current-chat",
        message: "Hello",
      });
      expect(session.currentChatId).toBe("new-chat-id");
      expect(session.save).toHaveBeenCalled();
    });

    test("chats/messages/new does not save session when chatId unchanged", async () => {
      mockNewChatMessage.mockResolvedValue("current-chat");
      const session = createMockSession();
      await onMessage(send, session, {
        cmd: "chats/messages/new",
        message: "Hi",
      });

      expect(session.save).not.toHaveBeenCalled();
    });

    test("chats/new calls newChat and saves session", async () => {
      const session = createMockSession();
      await onMessage(send, session, { cmd: "chats/new" });

      expect(mockNewChat).toHaveBeenCalledWith(send, "session-1");
      expect(session.currentChatId).toBe("new-chat-id");
      expect(session.save).toHaveBeenCalled();
    });

    test("chats/switch calls switchChat with correct chatId", async () => {
      const session = createMockSession();
      await onMessage(send, session, {
        cmd: "chats/switch",
        chatId: "other-chat",
      });

      expect(mockSwitchChat).toHaveBeenCalledWith(
        send,
        "session-1",
        "other-chat",
      );
      expect(session.currentChatId).toBe("other-chat");
      expect(session.save).toHaveBeenCalled();
    });

    test("chats/switch returns early when chatId is missing", async () => {
      const session = createMockSession();
      await onMessage(send, session, {
        cmd: "chats/switch",
        chatId: "",
      });

      expect(mockSwitchChat).not.toHaveBeenCalled();
    });

    test("chats/switch returns early when chatId equals currentChatId", async () => {
      const session = createMockSession();
      await onMessage(send, session, {
        cmd: "chats/switch",
        chatId: "current-chat",
      });

      expect(mockSwitchChat).not.toHaveBeenCalled();
    });

    test("users/new clears memory and destroys session", async () => {
      const session = createMockSession();
      await onMessage(send, session, { cmd: "users/new" });

      expect(mockClearMemory).toHaveBeenCalledWith(send, "session-1");
      expect(session.destroy).toHaveBeenCalled();
    });

    test("data/clear clears memory and saves session", async () => {
      const session = createMockSession();
      await onMessage(send, session, { cmd: "data/clear" });

      expect(mockClearMemory).toHaveBeenCalledWith(send, "session-1");
      expect(session.save).toHaveBeenCalled();
    });

    test("unknown command does not call any orchestrator method", async () => {
      const session = createMockSession();
      await onMessage(send, session, { cmd: "unknown/cmd" } as any);

      expect(mockNewChatMessage).not.toHaveBeenCalled();
      expect(mockNewChat).not.toHaveBeenCalled();
      expect(mockSwitchChat).not.toHaveBeenCalled();
      expect(mockClearMemory).not.toHaveBeenCalled();
    });
  });

  describe("initializeSocket", () => {
    test("type chat calls initializeChat and updates session", async () => {
      const session = createMockSession();
      await initializeSocket(send, "chat", session);

      expect(mockInitializeChat).toHaveBeenCalledWith(
        send,
        "session-1",
        "current-chat",
      );
      expect(session.currentChatId).toBe("init-chat-id");
      expect(session.save).toHaveBeenCalled();
    });

    test("type chat does not save session when chatId unchanged", async () => {
      mockInitializeChat.mockResolvedValue("current-chat");
      const session = createMockSession();
      await initializeSocket(send, "chat", session);

      expect(session.save).not.toHaveBeenCalled();
    });

    test("unknown type does not call initializeChat", async () => {
      const session = createMockSession();
      await initializeSocket(send, "projects" as any, session);

      expect(mockInitializeChat).not.toHaveBeenCalled();
    });
  });
});
