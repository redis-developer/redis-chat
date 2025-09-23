import { readStreamableValue } from "@ai-sdk/rsc";
import getClient from "../../redis";
import config from "../../config";
import { llm, embedText } from "../../services/ai/ai";
import { randomUlid } from "../../utils/uid";
import logger from "../../utils/log";
import * as view from "./view";
import { ShortTermMemoryModel, WorkingMemoryModel, Tools } from "../memory";
import type { ShortTermMemory } from "../memory";
import * as ai from "./ai";

async function getWorkingMemory(userId: string) {
  const redis = await getClient();

  return WorkingMemoryModel.New(redis, userId, {
    createUid: () => randomUlid(),
    vectorDimensions: llm.dimensions,
    embed: embedText,
    ttl: config.redis.DEFAULT_TTL,
  });
}

async function getTools(userId: string) {
  const workingMemory = await getWorkingMemory(userId);
  return Tools.New(workingMemory);
}

export async function getChatSession(userId: string, chatId?: string) {
  const redis = await getClient();

  return ShortTermMemoryModel.FromSessionId(redis, userId, chatId, {
    createUid: () => randomUlid(),
    ttl: config.redis.DEFAULT_TTL,
  });
}

/**
 * Clears all messages for a given user.
 */
export async function clearChat(userId: string, chatId: string) {
  const chat = await getChatSession(userId, chatId);
  await chat.clear();
}

export async function removeChat(userId: string, chatId: string) {
  const chat = await getChatSession(userId, chatId);

  chat.remove();
}

/**
 * Handles incoming chat messages from the client.
 */
export async function newChatMessage(
  updateView: (message: {
    replaceId?: string;
    id: string;
    content: string;
    role?: "user" | "assistant";
  }) => void,
  {
    botChatId,
    userId,
    chatId,
    message,
  }: { botChatId: string; userId: string; chatId?: string; message: string },
): Promise<string> {
  const workingMemory = await getWorkingMemory(userId);
  const chat = await getChatSession(userId, chatId);
  chatId = chat.sessionId;
  let response: ShortTermMemory = {
    id: botChatId,
    role: "assistant",
    content: "<progress></progress>",
    timestamp: Date.now(),
  };
  logger.debug(`Processing message for user \`${userId}\``, {
    userId,
  });

  const userMessage = await chat.push({
    role: "user",
    content: message,
  });

  logger.debug(`Message added for user \`${userId}\``, {
    userId,
  });

  updateView(userMessage);

  updateView(response);

  logger.info(`Searching for existing response in semantic memory.`, {
    userId,
  });

  const result = await workingMemory.searchSemanticMemory(message);

  if (result.length > 0) {
    logger.info(`Found response in semantic memory`, {
      userId,
    });
    response.content = result[0].answer;
  } else {
    logger.info(`No response found in semantic memory`, {
      userId,
    });

    const tools = await getTools(userId);

    const stream = ai.answerPrompt(await chat.memories(), tools);

    let content = "";

    for await (const delta of stream) {
      content += delta;
      response.content = content;
      const replacement = {
        ...response,
        replaceId: botChatId,
      };
      updateView(replacement);
    }

    await ai.storeMemories(message, response.content, tools);
  }

  response = await chat.push(response);

  logger.debug(`Bot message added to stream for user \`${userId}\``, {
    userId,
  });

  const replacement = {
    ...response,
    replaceId: botChatId,
  };

  updateView(replacement);

  return chatId;
}

export async function getChatsWithTopMessage(userId: string) {
  const existingChats = await ShortTermMemoryModel.AllSessions(
    await getClient(),
    userId,
    {
      createUid: () => randomUlid(),
    },
  );

  return existingChats.map((chat) => {
    return {
      chatId: chat.sessionId,
      length: chat.memories.length,
      message: chat.memories[0]?.content ?? "New chat",
    };
  });
}

/**
 * Creates a new chat user.
 */
export async function newChat(userId: string): Promise<string> {
  const newChat = await ShortTermMemoryModel.New(await getClient(), userId, {
    createUid: () => randomUlid(),
  });
  return newChat.sessionId;
}
