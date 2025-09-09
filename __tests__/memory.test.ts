import { afterAll, beforeEach, describe, test, mock, expect } from "bun:test";
import ChatModel from "../server/components/memory/chat";
import LongTermMemoryModel from "../server/components/memory/long";
import EpisodicMemoryModel from "../server/components/memory/episodic";
import SemanticMemoryModel from "../server/components/memory/semantic";
import WorkingMemoryModel from "../server/components/memory/working";
import getClient from "../server/redis";

const db = await getClient();
const userId = "123";

async function flush() {
  const keys = await db.keys("users:*");
  const semantic = await db.keys("semantic-memory*");

  if (Array.isArray(semantic) && semantic.length > 0) {
    keys.push(...semantic);
  }

  if (Array.isArray(keys) && keys.length > 0) {
    await db.del(keys);
  }

  const indexes = await db.ft._list();

  await Promise.all(
    indexes
      .filter((index) => {
        return index.includes(userId) || index.includes("semantic-memory");
      })
      .map(async (index) => {
        await db.ft.dropIndex(index);
      }),
  );
}

describe("Memory", () => {
  beforeEach(flush);
  afterAll(flush);

  test("ChatModel.Initialize can be called several times and creates the index", async () => {
    await ChatModel.Initialize(db, userId);
    await ChatModel.Initialize(db, userId);
    await ChatModel.Initialize(db, userId);
    await ChatModel.Initialize(db, userId);
  });

  test("ChatModel should manage all chats", async () => {
    const chat1 = await ChatModel.New(db, userId);
    const chat2 = await ChatModel.New(db, userId);
    const chats = await ChatModel.AllChats(db, userId);
    expect(chats.length).toBe(2); // Including the one created in beforeAll
    const chatIds = chats.map((chat) => chat.chatId);
    expect(chatIds).toContain(chat1.chatId);
    expect(chatIds).toContain(chat2.chatId);
  });

  test("AllChats should return the top message if it exists", async () => {
    const chat1 = await ChatModel.New(db, userId);
    const chat2 = await ChatModel.New(db, userId);

    await chat1.push({
      role: "user",
      content: "Hello",
    });
    await chat1.push({
      role: "assistant",
      content: "Hello, how can I help you?",
    });

    expect(chat1.length()).resolves.toBe(2);
    const chats = await ChatModel.AllChats(db, userId);
    expect(chats.length).toBe(2); // Including the one created in beforeAll
    const chat1Data = chats.find((chat) => chat.chatId === chat1.chatId);
    const chat2Data = chats.find((chat) => chat.chatId === chat2.chatId);
    expect(chat1Data?.messages.length).toBe(1);
    expect(chat1Data?.messages[0].content).toBe("Hello, how can I help you?");
    expect(chat2Data?.messages.length).toBe(0);
  });

  test("ChatModel should store and retrieve messages", async () => {
    const chatModel = await ChatModel.New(db, userId);
    expect(chatModel.length()).resolves.toBe(0);

    await chatModel.push({
      role: "user",
      content: "Hello",
    });
    await chatModel.push({
      role: "assistant",
      content: "Hi there!",
    });

    const messages = await chatModel.messages();
    expect(chatModel.length()).resolves.toBe(2);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].content).toBe("Hi there!");
    await chatModel.clear();
    expect(chatModel.length()).resolves.toBe(0);
  });

  test("LongTermMemoryModel should create the index on Initialize", async () => {
    const options = {
      vectorDimensions: 3,
      embed: async (text: string) => {
        return [0, 0, 0];
      },
      createUid: () => {
        return "test";
      },
    };
    await LongTermMemoryModel.Initialize(db, userId, options);
    await LongTermMemoryModel.Initialize(db, userId, options);
    await LongTermMemoryModel.Initialize(db, userId, options);
    await LongTermMemoryModel.Initialize(db, userId, options);
  });

  test("LongTermMemoryModel should store and retrieve memories", async () => {
    const longTermMemory = await LongTermMemoryModel.New(db, userId, {
      vectorDimensions: 3,
      embed: async (text: string) => {
        if (text === "What is the user's name?") {
          return [1, 0, 0];
        } else if (text === "What is the user's age?") {
          return [0, 1, 0];
        } else if (text === "What is the user's favorite color?") {
          return [0, 0, 1];
        }
        return [0, 0, 0];
      },
    });

    await longTermMemory.add("What is the user's name?", "John");
    await longTermMemory.add("What is the user's age?", "30");
    await longTermMemory.add("What is the user's favorite color?", "Blue");

    const results = await longTermMemory.search("Hello", 2);
    expect(results.length).toBe(2);
    expect(results[0].question).toBe("What is the user's name?");
    expect(results[0].answer).toBe("John");
    expect(results[1].question).toBe("What is the user's age?");
    expect(results[1].answer).toBe("30");
  });

  test("LongTermMemoryModel should allow updates", async () => {
    const longTermMemory = await LongTermMemoryModel.New(db, userId, {
      vectorDimensions: 3,
      embed: async (text: string) => {
        if (text === "What is the user's name?") {
          return [1, 0, 0];
        } else if (text === "What is the user's age?") {
          return [0, 1, 0];
        } else if (text === "What is the user's favorite color?") {
          return [0, 0, 1];
        }
        return [0, 0, 0];
      },
    });

    await longTermMemory.add("What is the user's name?", "John");
    let results = await longTermMemory.search("What is the user's name?", 1);
    expect(results.length).toBe(1);
    expect(results[0].question).toBe("What is the user's name?");
    expect(results[0].answer).toBe("John");

    // Add again with the same ID but different answer
    await longTermMemory.update(
      results[0].id,
      "What is the user's name?",
      "Jane",
    );
    results = await longTermMemory.search("What is the user's name?", 1);
    expect(results.length).toBe(1);
    expect(results[0].question).toBe("What is the user's name?");
    expect(results[0].answer).toBe("Jane");
  });

  test("EpisodicMemoryModel should create the index on Initialize", async () => {
    const options = {
      vectorDimensions: 3,
      embed: async (text: string) => {
        return [0, 0, 0];
      },
      createUid: () => {
        return "test";
      },
    };
    await EpisodicMemoryModel.Initialize(db, userId, options);
    await EpisodicMemoryModel.Initialize(db, userId, options);
    await EpisodicMemoryModel.Initialize(db, userId, options);
    await EpisodicMemoryModel.Initialize(db, userId, options);
  });

  test("EpisodicMemoryModel should store and retrieve memories", async () => {
    const episodicMemory = await EpisodicMemoryModel.New(db, userId, {
      vectorDimensions: 3,
      embed: async (text: string) => {
        if (text === "What was the conversation about bats?") {
          return [1, 0, 0];
        } else if (text === "What were we discussing about universities?") {
          return [0, 1, 0];
        } else if (text === "What happened in the job interview?") {
          return [0, 0, 1];
        }
        return [0, 0, 0];
      },
    });

    await episodicMemory.add("c1", "What was the conversation about bats?");
    await episodicMemory.add(
      "c2",
      "What were we discussing about universities?",
    );
    await episodicMemory.add("c3", "What happened in the job interview?");

    const results = await episodicMemory.search(
      "What was the conversation about bats?",
      2,
    );
    expect(results.length).toBe(2);
    expect(results[0].summary).toBe("What was the conversation about bats?");
    expect(results[0].chatId).toBe("c1");
    expect(results[1].summary).toBe(
      "What were we discussing about universities?",
    );
    expect(results[1].chatId).toBe("c2");
  });

  test("EpisodicMemoryModel should allow updates", async () => {
    const episodicMemory = await EpisodicMemoryModel.New(db, userId, {
      vectorDimensions: 3,
      embed: async (text: string) => {
        if (text === "What was the conversation about bats?") {
          return [1, 0, 0];
        } else if (text === "What were we discussing about universities?") {
          return [0, 1, 0];
        } else if (text === "What happened in the job interview?") {
          return [0, 0, 1];
        }
        return [0, 0, 0];
      },
    });

    await episodicMemory.add("c1", "What was the conversation about bats?");
    let results = await episodicMemory.search(
      "What was the conversation about bats?",
      1,
    );
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe("What was the conversation about bats?");
    expect(results[0].chatId).toBe("c1");

    await episodicMemory.update("c1", "We talked about flying mammals.");
    results = await episodicMemory.search("flying mammals", 1);
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe("We talked about flying mammals.");
    expect(results[0].chatId).toBe("c1");
  });

  test("SemanticMemoryModel should create the index on Initialize", async () => {
    const options = {
      vectorDimensions: 3,
      embed: async (text: string) => {
        return [0, 0, 0];
      },
      createUid: () => {
        return "test";
      },
    };
    await SemanticMemoryModel.Initialize(db, options);
    await SemanticMemoryModel.Initialize(db, options);
    await SemanticMemoryModel.Initialize(db, options);
    await SemanticMemoryModel.Initialize(db, options);
  });

  test("SemanticMemoryModel should store and retrieve memories", async () => {
    const semanticMemory = await SemanticMemoryModel.New(db, {
      vectorDimensions: 3,
      embed: async (text: string) => {
        if (text === "What year is it?") {
          return [1, 0, 0];
        } else if (text === "What color is the sky?") {
          return [0, 1, 0];
        } else if (text === "What planet are we on?") {
          return [0, 0, 1];
        }
        return [0, 0, 0];
      },
    });

    await semanticMemory.add("What year is it?", "2025");
    await semanticMemory.add("What color is the sky?", "blue");
    await semanticMemory.add("What planet are we on?", "Earth");

    const results = await semanticMemory.search("What year is it?", 2);
    expect(results.length).toBe(2);
    expect(results[0].question).toBe("What year is it?");
    expect(results[0].answer).toBe("2025");
    expect(results[1].question).toBe("What color is the sky?");
    expect(results[1].answer).toBe("blue");
  });

  test("SemanticMemoryModel should allow updates", async () => {
    const semanticMemory = await SemanticMemoryModel.New(db, {
      vectorDimensions: 3,
      embed: async (text: string) => {
        if (text === "What year is it?") {
          return [1, 0, 0];
        } else if (text === "What color is the sky?") {
          return [0, 1, 0];
        } else if (text === "What planet are we on?") {
          return [0, 0, 1];
        }
        return [0, 0, 0];
      },
    });

    await semanticMemory.add("What year is it?", "2025");
    let results = await semanticMemory.search("What year is it?", 1);
    expect(results.length).toBe(1);
    expect(results[0].question).toBe("What year is it?");
    expect(results[0].answer).toBe("2025");

    // Add again with the same ID but different answer
    await semanticMemory.update(results[0].id, "What year is it?", "2026");
    results = await semanticMemory.search("What year is it?", 1);
    expect(results.length).toBe(1);
    expect(results[0].question).toBe("What year is it?");
    expect(results[0].answer).toBe("2026");
  });

  test("WorkingMemoryModel should allow creating, updating, and searching LongTermMemoryModel, EpisodicMemoryModel, and SemanticMemoryModel", async () => {
    const options = {
      vectorDimensions: 4,
      embed: async (text: string) => {
        switch (text) {
          case "What year is it?":
            return [0, 0, 0, 0];
          case "What color is the sky?":
            return [0, 0, 0, 1];
          case "What planet are we on?":
            return [0, 0, 1, 0];
          case "What was the conversation about bats?":
            return [0, 0, 1, 1];
          case "What were we discussing about universities?":
            return [0, 1, 0, 0];
          case "What happened in the job interview?":
            return [0, 1, 0, 1];
          case "What is the user's name?":
            return [0, 1, 1, 0];
          case "What is the user's age?":
            return [0, 1, 1, 1];
          case "What is the user's favorite color?":
            return [1, 0, 0, 0];
          default:
            return [0, 0, 0, 0];
        }
      },
    };

    const workinMemoryModel = await WorkingMemoryModel.New(db, userId, options);

    await workinMemoryModel.addSemanticMemory("What year is it?", "2025");
    await workinMemoryModel.addSemanticMemory("What color is the sky?", "blue");
    await workinMemoryModel.addSemanticMemory(
      "What planet are we on?",
      "Earth",
    );

    await workinMemoryModel.addLongTermMemory(
      "c1",
      "What was the conversation about bats?",
    );
    await workinMemoryModel.addLongTermMemory(
      "c2",
      "What were we discussing about universities?",
    );
    await workinMemoryModel.addLongTermMemory(
      "c3",
      "What happened in the job interview?",
    );

    await workinMemoryModel.addEpisodicMemory(
      "What is the user's name?",
      "John",
    );
    await workinMemoryModel.addEpisodicMemory("What is the user's age?", "30");
    await workinMemoryModel.addEpisodicMemory(
      "What is the user's favorite color?",
      "Blue",
    );

    const results = await workinMemoryModel.search("What year is it?", 5);
    expect(results.length).toBe(5);
    expect(results[0].type).toBe("semantic");

    if (results[0].type === "semantic") {
      expect(results[0].question).toBe("What year is it?");
      expect(results[0].answer).toBe("2025");
    }
  });
});
