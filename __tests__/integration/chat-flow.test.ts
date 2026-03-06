import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createClient } from "redis";
import type { RedisClientType } from "redis";
import { ChatModel } from "../../server/components/memory/chat";

let redis: RedisClientType;
const testUserId = `test-user-${Date.now()}`;
let counter = 0;

function createUid() {
  return `test-chat-${Date.now()}-${counter++}`;
}

beforeAll(async () => {
  redis = createClient({ url: "redis://localhost:6379" }) as RedisClientType;
  await redis.connect();
});

afterAll(async () => {
  const keys = await redis.keys(ChatModel.Key(testUserId) + ":*");
  if (keys.length > 0) {
    await redis.del(keys);
  }

  const indexName = ChatModel.Index(testUserId);
  try {
    await redis.ft.dropIndex(indexName);
  } catch {
    // index may not exist
  }

  await redis.quit();
});

describe("integration: ChatModel lifecycle", () => {
  test("creates a new chat and persists it in Redis", async () => {
    const chat = await ChatModel.New(redis as any, testUserId, { createUid });

    expect(chat.chatId).toBeDefined();
    expect(chat.userId).toBe(testUserId);

    const exists = await redis.exists(chat.chatKey);
    expect(exists).toBe(1);
  });

  test("metadata returns correct default values for a new chat", async () => {
    const chat = await ChatModel.New(redis as any, testUserId, { createUid });
    const meta = await chat.metadata();

    expect(meta.userId).toBe(testUserId);
    expect(meta.chatId).toBe(chat.chatId);
    expect(meta.lastMessage).toBe("New chat");
  });

  test("updateLastMessage persists the change in Redis", async () => {
    const chat = await ChatModel.New(redis as any, testUserId, { createUid });
    await chat.updateLastMessage("Hello, world!");

    const meta = await chat.metadata();
    expect(meta.lastMessage).toBe("Hello, world!");
  });

  test("AllChats returns all created chats", async () => {
    const allChats = await ChatModel.AllChats(redis as any, testUserId, {
      createUid,
    });

    expect(allChats.length).toBeGreaterThanOrEqual(3);
    for (const chat of allChats) {
      expect(chat.userId).toBe(testUserId);
      expect(chat.chatId).toBeDefined();
    }
  });

  test("FromChatId returns an existing chat", async () => {
    const created = await ChatModel.New(redis as any, testUserId, {
      createUid,
    });
    await created.updateLastMessage("Specific message");

    const retrieved = await ChatModel.FromChatId(
      redis as any,
      testUserId,
      created.chatId,
      { createUid },
    );

    expect(retrieved.chatId).toBe(created.chatId);
    const meta = await retrieved.metadata();
    expect(meta.lastMessage).toBe("Specific message");
  });

  test("FromChatId creates a new chat when chatId does not exist", async () => {
    const chat = await ChatModel.FromChatId(
      redis as any,
      testUserId,
      "nonexistent-id",
      { createUid },
    );

    expect(chat.chatId).not.toBe("nonexistent-id");
    const exists = await redis.exists(chat.chatKey);
    expect(exists).toBe(1);
  });

  test("remove deletes the chat from Redis", async () => {
    const chat = await ChatModel.New(redis as any, testUserId, { createUid });
    const chatKey = chat.chatKey;

    const existsBefore = await redis.exists(chatKey);
    expect(existsBefore).toBe(1);

    await chat.remove();

    const existsAfter = await redis.exists(chatKey);
    expect(existsAfter).toBe(0);
  });

  test("full lifecycle: create, update, query, remove", async () => {
    const chat = await ChatModel.New(redis as any, testUserId, { createUid });
    const chatId = chat.chatId;

    const meta1 = await chat.metadata();
    expect(meta1.lastMessage).toBe("New chat");

    await chat.updateLastMessage("Updated message");
    const meta2 = await chat.metadata();
    expect(meta2.lastMessage).toBe("Updated message");

    const allChats = await ChatModel.AllChats(redis as any, testUserId);
    const found = allChats.find((c) => c.chatId === chatId);
    expect(found).toBeDefined();
    expect(found!.lastMessage).toBe("Updated message");

    await chat.remove();
    const allChatsAfter = await ChatModel.AllChats(redis as any, testUserId);
    const notFound = allChatsAfter.find((c) => c.chatId === chatId);
    expect(notFound).toBeUndefined();
  });
});
