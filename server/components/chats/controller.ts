import getClient from "../../redis";
import { memoryClient } from "../../services/memory";
import { UserId } from "agent-memory-client";
import type { MemoryMessage } from "agent-memory-client";
import { randomUlid } from "../../utils/uid";
import logger from "../../utils/log";
import { ChatModel } from "../memory/chat";
import { Tools } from "../memory/tools";
import * as ai from "./ai";
import { wait } from "../../utils/assert";

function getTools(userId: string) {
  return Tools.New(userId);
}

async function getChatModel(userId: string, chatId?: string) {
  const redis = await getClient();
  return ChatModel.FromChatId(redis, userId, chatId, {
    createUid: () => randomUlid(),
  });
}

export async function getChatMessages(
  chatId: string,
  userId: string,
): Promise<MemoryMessage[]> {
  const wm = await memoryClient.getOrCreateWorkingMemory(chatId, { userId });
  return wm.messages ?? [];
}

export async function getChatSession(userId: string, chatId?: string) {
  return getChatModel(userId, chatId);
}

export async function clearChat(userId: string, chatId: string) {
  await memoryClient.deleteWorkingMemory(chatId);
  await memoryClient.getOrCreateWorkingMemory(chatId, { userId });
}

export async function removeChat(userId: string, chatId: string) {
  const chat = await getChatModel(userId, chatId);
  await chat.remove();
  try {
    await memoryClient.deleteWorkingMemory(chatId);
  } catch {
    // session may not exist in AMS yet
  }
}

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
  const chat = await getChatModel(userId, chatId);
  chatId = chat.chatId;

  let responseContent = "<progress></progress>";
  const responseId = botChatId;

  logger.debug(`Processing message for user \`${userId}\``, { userId });

  const existingWm = await memoryClient.getOrCreateWorkingMemory(chatId, {
    userId,
  });
  const messages: MemoryMessage[] = existingWm.messages ?? [];

  const userMessage: MemoryMessage = {
    role: "user",
    content: message,
  };
  messages.push(userMessage);

  updateView({ id: `user-${randomUlid()}`, content: message, role: "user" });
  updateView({ id: responseId, content: responseContent, role: "assistant" });

  logger.info(`Searching for existing response in long-term memory.`, {
    userId,
  });

  const searchResults = await memoryClient.searchLongTermMemory({
    text: message,
    userId: new UserId({ eq: userId }),
    limit: 1,
    distanceThreshold: 0.15,
  });

  if (searchResults.memories.length > 0) {
    logger.info(`Found response in long-term memory`, { userId });
    responseContent = searchResults.memories[0].text;
  } else {
    logger.info(`No response found in long-term memory`, { userId });

    const tools = getTools(userId);
    const stream = ai.answerPrompt(messages, tools);

    responseContent = "";

    for await (const delta of stream) {
      const chunks = 20;

      for (let i = 0; i < delta.length; i += chunks) {
        responseContent += delta.slice(i, i + chunks);
        const replacement = {
          id: responseId,
          content: responseContent + "<br><progress></progress>",
          replaceId: botChatId,
          role: "assistant" as const,
        };
        updateView(replacement);
        await wait(50);
      }
    }

    await ai.storeMemories(message, responseContent, tools);
  }

  const assistantMessage: MemoryMessage = {
    role: "assistant",
    content: responseContent,
  };
  messages.push(assistantMessage);

  await memoryClient.putWorkingMemory(chatId, { messages });

  await chat.updateLastMessage(
    message.length > 80 ? message.substring(0, 80) + "..." : message,
  );

  logger.debug(`Bot message stored for user \`${userId}\``, { userId });

  updateView({
    id: responseId,
    content: responseContent,
    replaceId: botChatId,
    role: "assistant",
  });

  return chatId;
}

export async function getChatsWithTopMessage(userId: string) {
  const redis = await getClient();
  const existingChats = await ChatModel.AllChats(redis, userId, {
    createUid: () => randomUlid(),
  });

  return existingChats.map((chat) => {
    return {
      chatId: chat.chatId,
      length: chat.lastMessage !== "New chat" ? 1 : 0,
      message: chat.lastMessage,
    };
  });
}

export async function newChat(userId: string): Promise<string> {
  const redis = await getClient();
  const chat = await ChatModel.New(redis, userId, {
    createUid: () => randomUlid(),
  });
  return chat.chatId;
}
