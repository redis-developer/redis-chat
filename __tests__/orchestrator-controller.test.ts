import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockGetChatsWithTopMessage = mock(() => Promise.resolve([]));
const mockRemoveChat = mock(() => Promise.resolve());
const mockClearChatFn = mock(() => Promise.resolve());
const mockNewChatMessage = mock(() => Promise.resolve("chat-id"));
const mockGetChatMessages = mock(() => Promise.resolve([]));
const mockNewChatFn = mock(() => Promise.resolve("new-chat-id"));

mock.module("../server/components/chats", () => ({
  ctrl: {
    getChatsWithTopMessage: mockGetChatsWithTopMessage,
    removeChat: mockRemoveChat,
    clearChat: mockClearChatFn,
    newChatMessage: mockNewChatMessage,
    getChatMessages: mockGetChatMessages,
    newChat: mockNewChatFn,
    getChatSession: mock(),
  },
}));

const mockDeleteWorkingMemory = mock(() => Promise.resolve({ status: "ok" }));

mock.module("../server/services/memory", () => ({
  memoryClient: {
    deleteWorkingMemory: mockDeleteWorkingMemory,
  },
}));

const mockKeys = mock(() => Promise.resolve([]));
const mockDel = mock(() => Promise.resolve(0));

mock.module("../server/redis", () => ({
  default: () =>
    Promise.resolve({
      keys: mockKeys,
      del: mockDel,
    }),
}));

mock.module("../server/utils/uid", () => ({
  randomUlid: () => "test-ulid",
}));

mock.module("../server/utils/log", () => ({
  default: {
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock(),
  },
}));

import {
  removeEmptyChats,
  clearChat,
  newChatMessage,
  newChat,
  switchChat,
  initializeChat,
  clearMemory,
} from "../server/components/orchestrator/controller";

describe("orchestrator/controller", () => {
  const userId = "user-1";
  const chatId = "chat-1";
  const send = mock();

  beforeEach(() => {
    send.mockReset();
    mockGetChatsWithTopMessage.mockReset();
    mockRemoveChat.mockReset();
    mockClearChatFn.mockReset();
    mockNewChatMessage.mockReset();
    mockGetChatMessages.mockReset();
    mockNewChatFn.mockReset();
    mockDeleteWorkingMemory.mockReset();
    mockKeys.mockReset();
    mockDel.mockReset();

    mockGetChatsWithTopMessage.mockResolvedValue([]);
    mockNewChatFn.mockResolvedValue("new-chat-id");
    mockNewChatMessage.mockResolvedValue("chat-id");
    mockGetChatMessages.mockResolvedValue([]);
    mockKeys.mockResolvedValue([]);
  });

  describe("removeEmptyChats", () => {
    test("removes chats with length 0 that are not the current chat", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([
        { chatId: "c1", length: 0, message: "New chat" },
        { chatId: "c2", length: 1, message: "Hello" },
        { chatId: "c3", length: 0, message: "New chat" },
      ]);

      await removeEmptyChats(userId, "c1");

      expect(mockRemoveChat).toHaveBeenCalledTimes(1);
      expect(mockRemoveChat).toHaveBeenCalledWith(userId, "c3");
    });

    test("removes nothing when all chats have messages", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([
        { chatId: "c1", length: 1, message: "Hi" },
      ]);

      await removeEmptyChats(userId);

      expect(mockRemoveChat).not.toHaveBeenCalled();
    });
  });

  describe("clearChat", () => {
    test("clears chat and sends cleared view", async () => {
      await clearChat(send, userId, chatId);

      expect(mockClearChatFn).toHaveBeenCalledWith(userId, chatId);
      expect(send).toHaveBeenCalledTimes(1);
      const sentHtml = send.mock.calls[0][0];
      expect(sentHtml).toContain('id="messages"');
    });
  });

  describe("newChatMessage", () => {
    test("sends instructions and delegates to chats controller", async () => {
      mockNewChatMessage.mockResolvedValue("result-chat-id");

      const result = await newChatMessage(send, {
        userId,
        chatId,
        message: "Hello",
      });

      expect(send).toHaveBeenCalled();
      const firstCall = send.mock.calls[0][0];
      expect(firstCall).toContain('id="instructions"');
      expect(mockNewChatMessage).toHaveBeenCalledTimes(1);
      expect(result).toBe("result-chat-id");
    });

    test("rejects when chat controller throws (return without await)", async () => {
      mockNewChatMessage.mockRejectedValue(new Error("AI failure"));

      await expect(
        newChatMessage(send, {
          userId,
          chatId,
          message: "Hello",
        }),
      ).rejects.toThrow("AI failure");
    });
  });

  describe("newChat", () => {
    test("creates chat, renders sidebar, clears messages, and shows instructions", async () => {
      mockNewChatFn.mockResolvedValue("created-id");
      mockGetChatsWithTopMessage.mockResolvedValue([
        { chatId: "created-id", length: 0, message: "New chat" },
      ]);

      const result = await newChat(send, userId);

      expect(result).toBe("created-id");
      expect(mockNewChatFn).toHaveBeenCalledWith(userId);
      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[0][0]).toContain("sidebarChats");
      expect(send.mock.calls[1][0]).toContain('id="messages"');
      expect(send.mock.calls[2][0]).toContain("Ask anything");
    });
  });

  describe("switchChat", () => {
    test("renders sidebar, clears messages, and shows Ask anything for empty chat", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([
        { chatId, length: 0, message: "New chat" },
      ]);
      mockGetChatMessages.mockResolvedValue([]);

      await switchChat(send, userId, chatId);

      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[0][0]).toContain("sidebarChats");
      expect(send.mock.calls[1][0]).toContain('id="messages"');
      expect(send.mock.calls[2][0]).toContain("Ask anything");
    });

    test("renders existing messages", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([
        { chatId, length: 1, message: "Hi" },
      ]);
      mockGetChatMessages.mockResolvedValue([
        { id: "m1", role: "user", content: "Hello" },
        { id: "m2", role: "assistant", content: "Hi there" },
      ]);

      await switchChat(send, userId, chatId);

      // sidebar + clear + instructions + 2 messages
      expect(send).toHaveBeenCalledTimes(5);
    });
  });

  describe("initializeChat", () => {
    test("uses provided chatId", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([]);
      mockGetChatMessages.mockResolvedValue([]);

      const result = await initializeChat(send, userId, chatId);

      expect(result).toBe(chatId);
    });

    test("creates new chat when none exist and no chatId provided", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([]);
      mockNewChatFn.mockResolvedValue("fresh-chat");
      mockGetChatMessages.mockResolvedValue([]);

      const result = await initializeChat(send, userId);

      expect(mockNewChatFn).toHaveBeenCalledWith(userId);
      expect(result).toBe("fresh-chat");
    });

    test("uses first existing chat when no chatId provided", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([
        { chatId: "existing-1", length: 1, message: "Hi" },
        { chatId: "existing-2", length: 1, message: "Hey" },
      ]);
      mockGetChatMessages.mockResolvedValue([]);

      const result = await initializeChat(send, userId);

      expect(result).toBe("existing-1");
    });
  });

  describe("clearMemory", () => {
    test("deletes working memory for all chats and removes Redis keys", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([
        { chatId: "c1", length: 1, message: "Hi" },
        { chatId: "c2", length: 1, message: "Hey" },
      ]);
      mockKeys.mockResolvedValue(["users:uuser-1:chats:cc1", "users:uuser-1:chats:cc2"]);

      await clearMemory(send, userId);

      expect(mockDeleteWorkingMemory).toHaveBeenCalledTimes(2);
      expect(mockDeleteWorkingMemory).toHaveBeenCalledWith("c1");
      expect(mockDeleteWorkingMemory).toHaveBeenCalledWith("c2");
      expect(mockDel).toHaveBeenCalledWith([
        "users:uuser-1:chats:cc1",
        "users:uuser-1:chats:cc2",
      ]);
    });

    test("does not call del when no keys found", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([]);
      mockKeys.mockResolvedValue([]);

      await clearMemory(send, userId);

      expect(mockDel).not.toHaveBeenCalled();
    });

    test("ignores deleteWorkingMemory errors", async () => {
      mockGetChatsWithTopMessage.mockResolvedValue([
        { chatId: "c1", length: 1, message: "Hi" },
      ]);
      mockDeleteWorkingMemory.mockRejectedValue(new Error("not found"));
      mockKeys.mockResolvedValue([]);

      await expect(clearMemory(send, userId)).resolves.toBeUndefined();
    });
  });
});
