import getClient from "../../redis";
import { llm, embedText, answerPrompt, summarize, embedSummary, extract } from "../../services/ai/ai";
import { randomUlid } from "../../utils/uid";
import logger from "../../utils/log";
import * as view from "./view";
import * as memory from "../memory";
import dayjs from "dayjs";

async function flush(userId: string) {
  const db = getClient();
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

const longTermOptions: memory.LongTermMemoryModelOptions = {
  createUid: randomUlid,
  distanceThreshold: 0.12,
  embed: embedText,
  extract: extract,
  vectorDimensions: llm.dimensions,
};

async function getChat(userId: string, sessionId?: string) {
  const redis = getClient();

  return memory.ChatModel.FromSessionId(redis, userId, sessionId, {
    createUid: () => randomUlid(),
  });
}

async function getWorkingMemory(userId: string) {
  const redis = getClient();

  return memory.LongTermMemoryModel.New(redis, userId, longTermOptions);
}

/**
 * Clears all messages for a given user.
 */
export async function clearChat(
  send: (message: string) => void,
  userId: string,
  sessionId: string,
) {
  try {
    logger.info(`Clearing messages for user \`${userId}\``, {
      userId: userId,
    });

    const chat = await getChat(userId, sessionId);
    await chat.clear();
    send(view.clearMessages());
  } catch (error) {
    logger.error(`Failed to delete messages for user ${userId}:`, {
      error,
      userId: userId,
    });
    throw error;
  }
}

/**
 * Clears the entire store.
 */
export async function clearMemory(
  send: (message: string) => void,
  userId: string,
) {
  try {
    logger.info("Clearing Redis", {
      userId,
    });
    await flush(userId);
    send(view.clearMessages());
  } catch (error) {
    logger.error("Failed to clear memory:", {
      error,
      userId,
    });
    throw error;
  }
}

/**
 * Asks the LLM for a response to the given prompt.
 *
 * @param {string} userId - The ID of the chat user.
 * @param {string} sessionId - The ID of the chat user.
 */
export async function ask(userId: string, sessionId: string) {
  const chat = await getChat(userId, sessionId);
  const workingMemory = await getWorkingMemory(userId);
  const { summary, lastSummarizedAt } = await chat.metadata();
  let messages = await chat.messages();
  const question = messages[messages.length - 1].content;
  const lastSummarized = dayjs(lastSummarizedAt);

  if (typeof summary === "string" && summary.length > 0) {
    messages = messages.filter((message) => {
      return dayjs(message.createdAt).isAfter(lastSummarized);
    });
  }

  try {
    logger.info(
      `Retrieved ${messages.length} messages from user \`${userId}\``,
      {
        userId,
      },
    );

    logger.info(`Asking the LLM: ${question}`, {
      userId,
    });

    const existingResult = await workingMemory.search({
      query: question,
      requiresUserId: false,
      type: "semantic",
    });

    if (existingResult.length > 0) {
      logger.info(
        `Found ${existingResult.length} existing semantic memory entries for question: ${question}`,
        {
          userId,
        },
      );

      return existingResult[0].text;
    } else {
      logger.info(
        `No existing semantic memory found for question: ${question}`,
        {
          userId,
        },
      );
    }

    const result = await answerPrompt(messages, summary, [workingMemory.getSearchTool()]);

    logger.info(`LLM response received for question: ${question}`, {
      userId,
    });

    return result;
  } catch (error) {
    logger.error(`Failed to ask LLM \`${question}\`:`, {
      error,
      userId,
      prompt: question,
    });
    throw error;
  }
}

/**
 * Handles incoming chat messages from the client.
 */
export async function processChat(
  send: (message: string) => void,
  {
    userId,
    sessionId,
    message,
  }: { userId: string; sessionId?: string; message: string },
): Promise<string> {
  let botResponseSent = false;
  const chat = await getChat(userId, sessionId);
  const workingMemory = await getWorkingMemory(userId);
  sessionId = chat.sessionId;
  let response: memory.ChatMessage = {
    id: `bot-${randomUlid()}`,
    role: "assistant",
    content: "...",
    createdAt: new Date().toISOString(),
    extracted: "f",
  };
  const botId = response.id;

  try {
    logger.debug(`Processing message for user \`${userId}\``, {
      userId,
    });

    const userMessage = await chat.push({
      role: "user",
      content: message,
    });

    logger.info(`Message added for user \`${userId}\``, {
      userId,
    });

    send(view.renderMessage(userMessage));

    send(view.renderMessage(response));
    botResponseSent = true;

    if (response.content === "...") {
      response.content = await ask(userId, sessionId);
    }

    response = await chat.push(response);

    await workingMemory.extract([response], sessionId);

    logger.info(`Bot message added to stream for user \`${userId}\``, {
      userId,
    });

    const replacement = view.renderMessage({
      ...response,
      replaceId: botId,
    });

    send(replacement);

    return sessionId;
  } catch (error) {
    console.log(error);
    logger.error(`Error handling message:`, {
      error,
      userId,
    });

    const message: memory.ChatMessage = {
      id: botId,
      content: "An error occurred while processing your message.",
      role: "assistant",
      createdAt: new Date().toISOString(),
      extracted: "f",
    };

    if (botResponseSent) {
      send(
        view.renderMessage({
          replaceId: botId,
          ...message,
        }),
      );
    } else {
      send(view.renderMessage(message));
    }
  }

  return sessionId;
}

/**
 * Creates a new chat user.
 */
export async function newChat(
  send: (message: string) => void,
  userId: string,
): Promise<string> {
  try {
    logger.info(`Creating new chat for user \`${userId}\``, {
      userId,
    });
    const newChat = await memory.ChatModel.New(getClient(), userId, {
      createUid: () => randomUlid(),
    });
    const newSessionId = newChat.sessionId;
    const existingChats = await memory.ChatModel.AllChats(getClient(), userId, {
      createUid: () => randomUlid(),
    });

    const chats = [
      ...existingChats.map((chat) => {
        return {
          sessionId: chat.sessionId,
          message: chat.messages[0]?.content ?? "New chat",
        };
      }),
    ];

    send(
      view.renderChats({
        chats,
        currentSessionId: newSessionId,
      }),
    );

    send(
      view.clearMessages({
        placeholder: true,
      }),
    );

    return newSessionId;
  } catch (error) {
    logger.error(`Failed to create new chat for user \`${userId}\`:`, {
      error,
      userId,
    });
    throw error;
  }
}

/**
 * Switches the current chat user to a different chat.
 */
export async function switchChat(
  send: (message: string) => void,
  userId: string,
  sessionId: string,
) {
  try {
    logger.info(`Switching to chat \`${sessionId}\` for user \`${userId}\``, {
      userId,
    });
    const db = getClient();
    const options = {
      createUid: () => randomUlid(),
    };

    const chats = await memory.ChatModel.AllChats(db, userId, options);

    send(
      view.renderChats({
        chats: chats.map((chat) => {
          return {
            sessionId: chat.sessionId,
            message: chat.messages[0]?.content ?? "New chat",
          };
        }),
        currentSessionId: sessionId,
      }),
    );

    send(
      view.clearMessages({
        placeholder: false,
      }),
    );

    const chat = await memory.ChatModel.FromSessionId(db, userId, sessionId, options);
    const messages = await chat.messages();

    for (const message of messages) {
      send(view.renderMessage(message));
    }
  } catch (error) {
    logger.error(`Failed to switch chat for user \`${userId}\`:`, {
      error,
      userId,
    });
    throw error;
  }
}

/**
 * Initializes the chat by sending all previous messages to the WebSocket client.
 */
export async function initializeChat(
  send: (message: string) => void,
  userId: string,
  sessionId: string,
) {
  try {
    logger.info(`Initializing chat for user \`${userId}\``, {
      userId,
    });

    const db = getClient();
    const options = {
      createUid: () => randomUlid(),
    };
    const chat = await memory.ChatModel.FromSessionId(db, userId, sessionId, options);
    const messages = await chat.messages();
    const placeholder = messages.length === 0;

    send(
      view.clearMessages({
        placeholder,
      }),
    );

    for (const message of messages) {
      send(view.renderMessage(message));
    }
  } catch (error) {
    logger.error(`Failed to initialize chat for user \`${userId}\`:`, {
      error,
      userId,
    });
  }
}

export async function summarizeChat(userId: string, sessionId: string) {
  try {
    const db = getClient();
    const options = {
      createUid: () => randomUlid(),
    };
    const workingMemory = await getWorkingMemory(userId);
    const chat = await memory.ChatModel.FromSessionId(db, userId, sessionId, options);
    const messages = await chat.messages();
    const { summary, lastSummarizedAt } = await chat.metadata();
    const lastSummarized = dayjs(lastSummarizedAt);
    const messagesToSummarize = messages.filter((message) => {
      return dayjs(message.createdAt).isAfter(lastSummarized);
    });

    if (messagesToSummarize.length < 5) {
      return;
    }

    logger.info(`Summarizing chat ${sessionId} for user ${userId}`, {
      userId,
      sessionId,
    });
    
    const newSummary = await summarize(messagesToSummarize, summary, []);

    logger.info(`Chat ${sessionId} for user ${userId} summarized.`, {
      userId,
      sessionId,
      summary: newSummary,
    });

    await chat.updateSummary(newSummary);
  } catch (error) {
    logger.error(`Failed to summarize chat \`${sessionId}\` for user \`${userId}\`:`, {
      error,
      userId,
      sessionId,
    });
  }
}

/**
 * Retrieves the chat history for a given user.
 */
export async function getAllChats(userId: string) {
  try {
    logger.info(`Initializing chat history for user \`${userId}\``, {
      userId,
    });

    const existingChats = await memory.ChatModel.AllChats(getClient(), userId, {
      createUid: () => randomUlid(),
    });

    return existingChats.map((chat) => {
      return {
        sessionId: chat.sessionId,
        message: chat.messages[0]?.content ?? "New chat",
      };
    });
  } catch (error) {
    logger.error(`Failed to initialize chat history for user \`${userId}\`:`, {
      error,
      userId,
    });
  }
}
