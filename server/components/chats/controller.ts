import getClient from "../../redis";
import { memoryClient } from "../../services/memory";
import type { MemoryMessage } from "agent-memory-client";
import { randomUlid } from "../../utils/uid";
import logger from "../../utils/log";
import { ChatModel } from "../memory/chat";
import { Tools } from "../memory/tools";
import * as ai from "./ai";
import { wait } from "../../utils/assert";

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
    created_at: new Date().toISOString(),
  };
  messages.push(userMessage);

  updateView({ id: `user-${randomUlid()}`, content: message, role: "user" });
  updateView({ id: responseId, content: responseContent, role: "assistant" });

  logger.info(`Fetching memory-enriched prompt context.`, { userId });

  const memoryContext = await memoryClient.memoryPrompt({
    query: message,
    session: {
      session_id: chatId,
      user_id: userId,
    },
    long_term_search: {
      text: message,
      user_id: { eq: userId },
      limit: 5,
    },
  });

  const enrichedMessages = memoryContext.messages.map((message) => {
    return {
      role: message.role,
      content: (message.content as { text: string }).text,
    };
  }) as MemoryMessage[];

  const tools = Tools.New(userId);
  const stream = ai.answerPrompt(enrichedMessages, tools);

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

  updateView({
    id: responseId,
    content: responseContent,
    replaceId: botChatId,
    role: "assistant",
  });

  await ai.storeMemories(message, responseContent, tools);

  const assistantMessage: MemoryMessage = {
    role: "assistant",
    content: responseContent,
    created_at: new Date().toISOString(),
  };
  messages.push(assistantMessage);

  await memoryClient.putWorkingMemory(chatId, { messages });

  await chat.updateLastMessage(
    message.length > 80 ? message.substring(0, 80) + "..." : message,
  );

  logger.debug(`Bot message stored for user \`${userId}\``, { userId });

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
