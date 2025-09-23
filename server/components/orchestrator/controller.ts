import logger from "../../utils/log";
import { llm, embedText } from "../../services/ai/ai";
import config from "../../config";
import getClient from "../../redis";
import { WorkingMemoryModel } from "../memory";
import { randomUlid } from "../../utils/uid";
import { ctrl as chats } from "../chats";
import * as view from "./view";

async function getWorkingMemory(userId: string) {
  const redis = await getClient();

  return WorkingMemoryModel.New(redis, userId, {
    createUid: randomUlid,
    vectorDimensions: llm.dimensions,
    embed: embedText,
    ttl: config.redis.DEFAULT_TTL,
  });
}

export async function removeEmptyChats(userId: string, chatId?: string) {
  try {
    const allChats = await chats.getChatsWithTopMessage(userId);

    await Promise.all(
      allChats
        .filter((chat) => !(chat.length > 0 || chat.chatId === chatId))
        .map((chat) => {
          return chats.removeChat(userId, chat.chatId);
        }),
    );
  } catch (error) {
    logger.error(`Failed to remove empty chats for user \`${userId}\`:`, {
      error,
      userId,
    });
    throw error;
  }
}

/**
 * Clears all messages for a given user.
 */
export async function clearChat(
  send: (message: string) => void,
  userId: string,
  chatId: string,
) {
  try {
    logger.debug(`Clearing messages for user \`${userId}\``, {
      userId: userId,
    });

    await chats.clearChat(userId, chatId);
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
 * Handles incoming chat messages from the client.
 */
export async function newChatMessage(
  send: (message: string) => void,
  info: { userId: string; chatId?: string; message: string },
): Promise<string | undefined> {
  const botChatId = `bot-${randomUlid()}`;

  send(view.renderInstructions());

  try {
    return chats.newChatMessage(
      (message: {
        replaceId?: string;
        id: string;
        content: string;
        role?: "user" | "assistant";
      }) => {
        send(view.renderMessage(message));
      },
      {
        ...info,
        botChatId,
      },
    );
  } catch (error) {
    logger.error(`Error handling message:`, {
      error,
      userId: info.userId,
    });

    send(
      view.renderMessage({
        id: botChatId,
        content: "An error occurred while processing your message.",
        role: "assistant",
      }),
    );
  }
}

/**
 * Creates a new chat user.
 */
export async function newChat(
  send: (message: string) => void,
  userId: string,
): Promise<string> {
  try {
    logger.debug(`Creating new chat for user \`${userId}\``, {
      userId,
    });
    const newChatId = await chats.newChat(userId);
    const allChats = await chats.getChatsWithTopMessage(userId);

    send(
      view.renderChats({
        chats: allChats,
        currentChatId: newChatId,
      }),
    );

    send(view.clearMessages());

    send(
      view.renderInstructions({
        instructions: "Ask anything",
      }),
    );

    return newChatId;
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
  chatId: string,
) {
  try {
    logger.debug(`Switching to chat \`${chatId}\` for user \`${userId}\``, {
      userId,
    });

    send(
      view.renderChats({
        chats: await chats.getChatsWithTopMessage(userId),
        currentChatId: chatId,
      }),
    );

    const chat = await chats.getChatSession(userId, chatId);
    const memories = await chat.memories();

    send(view.clearMessages());

    send(
      view.renderInstructions({
        instructions: memories.length === 0 ? "Ask anything" : "",
      }),
    );

    for (const memory of memories) {
      send(view.renderMessage(memory));
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
  chatId?: string,
) {
  try {
    logger.debug(`Initializing chat for user \`${userId}\``, {
      userId,
    });

    await removeEmptyChats(userId, chatId);

    if (!chatId) {
      const allChats = await chats.getChatsWithTopMessage(userId);

      if (allChats.length === 0) {
        chatId = await chats.newChat(userId);
      } else {
        chatId = allChats[0].chatId;
      }
    }

    await switchChat(send, userId, chatId);

    return chatId;
  } catch (error) {
    logger.error(`Failed to initialize chat for user \`${userId}\`:`, {
      error,
      userId,
    });
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
    logger.debug("Clearing Redis", {
      userId,
    });

    const db = await getClient();
    const allKeys = await db.keys(`users:u${userId}:*`);

    if (Array.isArray(allKeys) && allKeys.length > 0) {
      await db.del(allKeys);
    }
  } catch (error) {
    logger.error("Failed to clear memory:", {
      error,
      userId,
    });
    throw error;
  }
}
