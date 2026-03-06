import { describe, test, expect, mock, beforeEach } from "bun:test";
import { ChatModel } from "../../server/components/memory/chat";

function createMockDb() {
  return {
    json: {
      get: mock(() => Promise.resolve(null)),
      set: mock(() => Promise.resolve("OK")),
      del: mock(() => Promise.resolve(1)),
    },
    exists: mock(() => Promise.resolve(0)),
    ft: {
      _list: mock(() => Promise.resolve([])),
      create: mock(() => Promise.resolve("OK")),
      search: mock(() => Promise.resolve({ total: 0, documents: [] })),
    },
  } as any;
}

describe("ChatModel", () => {
  const userId = "user-abc";
  const chatId = "chat-xyz";

  describe("Key", () => {
    test("returns base key without chatId", () => {
      expect(ChatModel.Key(userId)).toBe(`users:u${userId}:chats`);
    });

    test("returns full key with chatId", () => {
      expect(ChatModel.Key(userId, chatId)).toBe(
        `users:u${userId}:chats:c${chatId}`,
      );
    });
  });

  describe("Index", () => {
    test("returns index name with dashes replacing colons", () => {
      const index = ChatModel.Index(userId);
      expect(index).toBe(`idx-users-u${userId}-chats`);
    });
  });

  describe("New", () => {
    test("creates a new chat record in Redis", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([]);
      db.exists.mockResolvedValue(0);

      const chat = await ChatModel.New(db, userId, {
        createUid: () => chatId,
      });

      expect(chat.chatId).toBe(chatId);
      expect(chat.userId).toBe(userId);
      expect(db.json.set).toHaveBeenCalled();
      const setCall = db.json.set.mock.calls[0];
      expect(setCall[0]).toBe(ChatModel.Key(userId, chatId));
      expect(setCall[1]).toBe("$");
      expect(setCall[2]).toMatchObject({
        userId,
        chatId,
        lastMessage: "New chat",
      });
    });

    test("does not overwrite existing chat", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([]);
      db.exists.mockResolvedValue(1);
      db.json.get.mockResolvedValue({
        userId,
        chatId,
        lastMessage: "Hello",
      });

      const chat = await ChatModel.New(db, userId, {
        createUid: () => chatId,
      });

      expect(chat.chatId).toBe(chatId);
      expect(db.json.set).not.toHaveBeenCalled();
    });
  });

  describe("Initialize", () => {
    test("creates index when it does not exist", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([]);

      await ChatModel.Initialize(db, userId);

      expect(db.ft.create).toHaveBeenCalledTimes(1);
      const createCall = db.ft.create.mock.calls[0];
      expect(createCall[0]).toBe(ChatModel.Index(userId));
    });

    test("skips index creation when index already exists", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([ChatModel.Index(userId)]);

      await ChatModel.Initialize(db, userId);

      expect(db.ft.create).not.toHaveBeenCalled();
    });
  });

  describe("FromChatId", () => {
    test("returns existing chat when chatId exists in Redis", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([ChatModel.Index(userId)]);
      db.exists.mockResolvedValue(1);

      const chat = await ChatModel.FromChatId(db, userId, chatId);

      expect(chat.chatId).toBe(chatId);
      expect(db.json.set).not.toHaveBeenCalled();
    });

    test("creates new chat when chatId does not exist in Redis", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([ChatModel.Index(userId)]);
      db.exists.mockResolvedValue(0);

      const newId = "new-chat-id";
      const chat = await ChatModel.FromChatId(db, userId, chatId, {
        createUid: () => newId,
      });

      expect(chat.chatId).toBe(newId);
      expect(db.json.set).toHaveBeenCalled();
    });

    test("creates new chat when chatId is undefined", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([ChatModel.Index(userId)]);
      db.exists.mockResolvedValue(0);

      const newId = "generated-id";
      const chat = await ChatModel.FromChatId(db, userId, undefined, {
        createUid: () => newId,
      });

      expect(chat.chatId).toBe(newId);
    });
  });

  describe("AllChats", () => {
    test("returns empty array when no chats exist", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([ChatModel.Index(userId)]);
      db.ft.search.mockResolvedValue({ total: 0, documents: [] });

      const chats = await ChatModel.AllChats(db, userId);

      expect(chats).toEqual([]);
    });

    test("returns mapped chat documents", async () => {
      const db = createMockDb();
      db.ft._list.mockResolvedValue([ChatModel.Index(userId)]);
      db.ft.search.mockResolvedValue({
        total: 2,
        documents: [
          {
            id: "doc1",
            value: { userId, chatId: "c1", lastMessage: "Hello" },
          },
          {
            id: "doc2",
            value: { userId, chatId: "c2", lastMessage: "World" },
          },
        ],
      });

      const chats = await ChatModel.AllChats(db, userId);

      expect(chats).toHaveLength(2);
      expect(chats[0]).toEqual({
        userId,
        chatId: "c1",
        lastMessage: "Hello",
      });
      expect(chats[1]).toEqual({
        userId,
        chatId: "c2",
        lastMessage: "World",
      });
    });
  });

  describe("instance methods", () => {
    let db: ReturnType<typeof createMockDb>;
    let chat: ChatModel;

    beforeEach(async () => {
      db = createMockDb();
      db.ft._list.mockResolvedValue([ChatModel.Index(userId)]);
      db.exists.mockResolvedValue(1);
      chat = await ChatModel.FromChatId(db, userId, chatId);
    });

    describe("metadata", () => {
      test("returns metadata from Redis", async () => {
        db.json.get.mockResolvedValue({
          userId,
          chatId,
          lastMessage: "Hi there",
        });

        const meta = await chat.metadata();

        expect(meta).toEqual({
          userId,
          chatId,
          lastMessage: "Hi there",
        });
      });

      test("returns default lastMessage when data is null", async () => {
        db.json.get.mockResolvedValue(null);

        const meta = await chat.metadata();

        expect(meta.lastMessage).toBe("New chat");
      });
    });

    describe("updateLastMessage", () => {
      test("sets lastMessage in Redis", async () => {
        await chat.updateLastMessage("Updated message");

        expect(db.json.set).toHaveBeenCalledWith(
          ChatModel.Key(userId, chatId),
          "$.lastMessage",
          "Updated message",
        );
      });
    });

    describe("remove", () => {
      test("deletes the chat key from Redis", async () => {
        await chat.remove();

        expect(db.json.del).toHaveBeenCalledWith(
          ChatModel.Key(userId, chatId),
        );
      });
    });
  });
});
