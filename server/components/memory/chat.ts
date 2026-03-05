import { SCHEMA_FIELD_TYPE } from "redis";
import type { RediSearchSchema } from "redis";
import type { RedisClient } from "../../redis";
import { randomUlid } from "../../utils/uid";

export interface ChatModelOptions {
  createUid?(): string;
}

export interface ChatMetadata {
  userId: string;
  chatId: string;
  lastMessage: string;
}

export interface Chat extends ChatMetadata {}

export class ChatModel {
  static Key(userId: string, chatId?: string) {
    if (!chatId) {
      return `users:u${userId}:chats`;
    }

    return `users:u${userId}:chats:c${chatId}`;
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
    await chat.createIfNotExists();
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
      "$.lastMessage": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "lastMessage",
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

    const all = await db.ft.search(ChatModel.Index(userId), "*", {
      RETURN: ["userId", "chatId", "lastMessage"],
    });

    if (all.total <= 0) {
      return [];
    }

    return all.documents.map(({ value }) => {
      return value as unknown as Chat;
    });
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

  async metadata(): Promise<ChatMetadata> {
    const data = (await this.db.json.get(this.chatKey)) as unknown as Chat | null;

    return {
      userId: this.userId,
      chatId: this.chatId,
      lastMessage: data?.lastMessage ?? "New chat",
    };
  }

  async updateLastMessage(message: string): Promise<void> {
    await this.db.json.set(this.chatKey, "$.lastMessage", message);
  }

  async remove(): Promise<void> {
    await this.db.json.del(this.chatKey);
  }

  private async createIfNotExists(): Promise<Chat> {
    const exists = await this.db.exists(this.chatKey);
    const chat: Chat = exists
      ? ((await this.db.json.get(this.chatKey)) as unknown as Chat)
      : {
          userId: this.userId,
          chatId: this.chatId,
          lastMessage: "New chat",
        };

    if (!exists) {
      await this.db.json.set(this.chatKey, "$", chat as any);
    }

    return chat;
  }
}

export default ChatModel;
