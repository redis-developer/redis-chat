import { SCHEMA_FIELD_TYPE } from "redis";
import type { RediSearchSchema } from "redis";
import type { RedisClient } from "../../redis";
import { randomUlid } from "../../utils/uid";

export interface ChatModelOptions {
  createUid?(): string;
}

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: number;
}

export type CreateMessage = Pick<ChatMessage, "role" | "content">;

export interface ChatMetadata {
  userId: string;
  chatId: string;
  summary: string;
  lastSummarizedAt?: number;
}

export interface Chat extends ChatMetadata {
  messages: ChatMessage[];
}

export class ChatModel {
  static Key(userId: string, chatId?: string) {
    if (!chatId) {
      return `users:u${userId}:memory:conversations`;
    }

    return `users:u${userId}:memory:conversations:c${chatId}`;
  }

  static Index(userId: string) {
    return `idx-${ChatModel.Key(userId).replace(/:/g, "-")}`;
  }

  static async New(
    db: RedisClient,
    userId: string,
    options?: ChatModelOptions,
  ) {
    const requiredOptions = ChatModel.DefaultOptions(options);
    await ChatModel.Initialize(db, userId);

    const chat = new ChatModel(
      db,
      userId,
      requiredOptions.createUid(),
      requiredOptions,
    );
    await chat.initialize();
    return chat;
  }

  static async Initialize(db: RedisClient, userId: string) {
    const schema: RediSearchSchema = {
      "$.userId": {
        type: SCHEMA_FIELD_TYPE.TAG,
        AS: "userId",
      },
      "$.chatId": {
        type: SCHEMA_FIELD_TYPE.TAG,
        AS: "chatId",
      },
      "$.summary": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "summary",
      },
      "$.lastSummarizedAt": {
        type: SCHEMA_FIELD_TYPE.NUMERIC,
        AS: "lastSummarizedAt",
      },
    };

    const chatKey = ChatModel.Key(userId);
    const index = ChatModel.Index(userId);
    const keys = await db.ft._list();

    if (keys.includes(index)) {
      return;
    }

    await db.ft.create(index, schema, {
      ON: "JSON",
      PREFIX: `${chatKey}:`,
    });
  }

  static async FromChatId(
    db: RedisClient,
    userId: string,
    chatId?: string,
    options?: ChatModelOptions,
  ) {
    await ChatModel.Initialize(db, userId);

    if (!chatId) {
      return ChatModel.New(db, userId, options);
    }

    const exists = await db.exists(ChatModel.Key(userId, chatId));
    const requiredOptions = ChatModel.DefaultOptions(options);

    if (!exists) {
      return ChatModel.New(db, userId, requiredOptions);
    }

    return new ChatModel(db, userId, chatId, requiredOptions);
  }

  static async AllChats(
    db: RedisClient,
    userId: string,
    options?: ChatModelOptions,
  ): Promise<Chat[]> {
    await ChatModel.Initialize(db, userId);
    options = ChatModel.DefaultOptions(options);

    const all = await db.ft.search(ChatModel.Index(userId), "*", {
      RETURN: ["userId", "chatId", "summary", "lastSummarizedAt"],
    });

    if (all.total <= 0) {
      return [];
    }

    return Promise.all(
      all.documents.map(async ({ id, value }) => {
        const dbChat = value as unknown as Omit<Chat, "messages">;
        const model = await ChatModel.FromChatId(
          db,
          userId,
          dbChat.chatId,
          options,
        );
        const messages = [];
        const top = await model.top();

        if (top) {
          messages.push(top);
        }
        return {
          ...dbChat,
          messages,
        };
      }),
    );
  }

  private static DefaultOptions(
    options?: ChatModelOptions,
  ): Required<ChatModelOptions> {
    return Object.assign(
      {},
      {
        createUid: randomUlid,
      },
      options,
    );
  }

  db: RedisClient;
  userId: string;
  chatId: string;
  chatKey: string;
  options: Required<ChatModelOptions>;

  constructor(
    db: RedisClient,
    userId: string,
    chatId: string,
    options: Required<ChatModelOptions>,
  ) {
    this.db = db;
    this.userId = userId;
    this.chatId = chatId;
    this.chatKey = ChatModel.Key(userId, chatId);
    this.options = options;
  }

  async initialize() {
    await this.createIfNotExists();
  }

  async metadata(): Promise<ChatMetadata> {
    let summaries = (await this.db.json.get(this.chatKey, {
      path: ["summary", "lastSummarizedAt"],
    })) as null | { summary: string; lastSummarizedAt: number };

    return {
      userId: this.userId,
      chatId: this.chatId,
      summary: summaries?.summary ?? "",
      lastSummarizedAt: summaries?.lastSummarizedAt ?? 0,
    };
  }

  async chat(): Promise<Chat> {
    const chat: unknown = await this.db.json.get(this.chatKey);

    return chat as Chat;
  }

  async length(): Promise<number> {
    const lengths = await this.db.json.arrLen(this.chatKey, {
      path: "$.messages",
    });

    if (Array.isArray(lengths)) {
      return lengths[0] ?? 0;
    }

    return lengths;
  }

  async messages(): Promise<ChatMessage[]> {
    const messages: unknown = await this.db.json.get(this.chatKey, {
      path: "$.messages",
    });

    if (Array.isArray(messages)) {
      if (Array.isArray(messages[0])) {
        return messages[0] as ChatMessage[];
      } else {
        return messages as ChatMessage[];
      }
    }

    return [];
  }

  async top(): Promise<ChatMessage | null> {
    const length = await this.length();

    if (length === 0) {
      return null;
    }

    const last = (await this.db.json.get(this.chatKey, {
      path: `$.messages[${length - 1}]`,
    })) as unknown;

    if (Array.isArray(last)) {
      return last[0] as ChatMessage;
    }

    return last as ChatMessage | null;
  }

  async push(newMessage: CreateMessage): Promise<ChatMessage> {
    const message = {
      id: this.options.createUid(),
      role: newMessage.role,
      content: newMessage.content,
      timestamp: Date.now(),
    };

    await this.db.json.arrAppend(this.chatKey, "$.messages", message);

    return message;
  }

  async clear(): Promise<void> {
    await this.db.json.clear(this.chatKey, {
      path: "$.messages",
    });
  }

  private async createIfNotExists(): Promise<Chat> {
    const exists = await this.db.exists(this.chatKey);
    const chat: Chat = exists
      ? ((await this.db.json.get(this.chatKey)) as unknown as Chat)
      : {
          userId: this.userId,
          chatId: this.chatId,
          summary: "",
          lastSummarizedAt: Date.now(),
          messages: [],
        };

    if (!exists) {
      await this.db.json.set(this.chatKey, "$", chat as any);
    }

    return chat;
  }
}

export default ChatModel;
