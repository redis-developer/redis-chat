import { SCHEMA_FIELD_TYPE } from "redis";
import type { RediSearchSchema } from "redis";
import type { RedisClient } from "../../redis";
import { randomUlid } from "../../utils/uid";

export interface ShortTermMemoryModelOptions {
  createUid?(): string;
  ttl?: number;
}

export interface ShortTermMemory {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: number;
}

export type CreateMemory = Pick<ShortTermMemory, "role" | "content">;

export interface SessionMetadata {
  userId: string;
  sessionId: string;
  summary: string;
  lastSummarizedAt?: number;
}

export interface Session extends SessionMetadata {
  memories: ShortTermMemory[];
}

export class ShortTermMemoryModel {
  static Key(userId: string, sessionId?: string) {
    if (!sessionId) {
      return `users:u${userId}:memory:shortterm`;
    }

    return `users:u${userId}:memory:shortterm:c${sessionId}`;
  }

  static Index(userId: string) {
    return `idx-${ShortTermMemoryModel.Key(userId).replace(/:/g, "-")}`;
  }

  static async New(
    db: RedisClient,
    userId: string,
    options?: ShortTermMemoryModelOptions,
  ) {
    const requiredOptions = ShortTermMemoryModel.DefaultOptions(options);
    await ShortTermMemoryModel.Initialize(db, userId);

    const model = new ShortTermMemoryModel(
      db,
      userId,
      requiredOptions.createUid(),
      requiredOptions,
    );
    await model.initialize();
    return model;
  }

  static async Initialize(db: RedisClient, userId: string) {
    const schema: RediSearchSchema = {
      "$.userId": {
        type: SCHEMA_FIELD_TYPE.TAG,
        AS: "userId",
      },
      "$.sessionId": {
        type: SCHEMA_FIELD_TYPE.TAG,
        AS: "sessionId",
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

    const memoryKey = ShortTermMemoryModel.Key(userId);
    const index = ShortTermMemoryModel.Index(userId);
    const keys = await db.ft._list();

    if (keys.includes(index)) {
      return;
    }

    await db.ft.create(index, schema, {
      ON: "JSON",
      PREFIX: `${memoryKey}:`,
    });
  }

  static async FromSessionId(
    db: RedisClient,
    userId: string,
    sessionId?: string,
    options?: ShortTermMemoryModelOptions,
  ) {
    await ShortTermMemoryModel.Initialize(db, userId);

    if (!sessionId) {
      return ShortTermMemoryModel.New(db, userId, options);
    }

    const exists = await db.exists(ShortTermMemoryModel.Key(userId, sessionId));
    const requiredOptions = ShortTermMemoryModel.DefaultOptions(options);

    if (!exists) {
      return ShortTermMemoryModel.New(db, userId, requiredOptions);
    }

    return new ShortTermMemoryModel(db, userId, sessionId, requiredOptions);
  }

  static async AllSessions(
    db: RedisClient,
    userId: string,
    options?: ShortTermMemoryModelOptions,
  ): Promise<Session[]> {
    await ShortTermMemoryModel.Initialize(db, userId);
    options = ShortTermMemoryModel.DefaultOptions(options);

    const all = await db.ft.search(ShortTermMemoryModel.Index(userId), "*", {
      RETURN: ["userId", "sessionId", "summary", "lastSummarizedAt"],
    });

    if (all.total <= 0) {
      return [];
    }

    return Promise.all(
      all.documents.map(async ({ id, value }) => {
        const dbSession = value as unknown as Omit<Session, "memories">;
        const model = await ShortTermMemoryModel.FromSessionId(
          db,
          userId,
          dbSession.sessionId,
          options,
        );
        const memories = [];
        const top = await model.top();

        if (top) {
          memories.push(top);
        }
        return {
          ...dbSession,
          memories,
        };
      }),
    );
  }

  private static DefaultOptions(
    options?: ShortTermMemoryModelOptions,
  ): Required<ShortTermMemoryModelOptions> {
    return Object.assign(
      {},
      {
        createUid: randomUlid,
        ttl: -1,
      },
      options,
    );
  }

  db: RedisClient;
  userId: string;
  sessionId: string;
  sessionKey: string;
  options: Required<ShortTermMemoryModelOptions>;

  constructor(
    db: RedisClient,
    userId: string,
    sessionId: string,
    options: Required<ShortTermMemoryModelOptions>,
  ) {
    this.db = db;
    this.userId = userId;
    this.sessionId = sessionId;
    this.sessionKey = ShortTermMemoryModel.Key(userId, sessionId);
    this.options = options;
  }

  async initialize() {
    await this.createIfNotExists();
  }

  async metadata(): Promise<SessionMetadata> {
    let summaries = (await this.db.json.get(this.sessionKey, {
      path: ["summary", "lastSummarizedAt"],
    })) as null | { summary: string; lastSummarizedAt: number };

    return {
      userId: this.userId,
      sessionId: this.sessionId,
      summary: summaries?.summary ?? "",
      lastSummarizedAt: summaries?.lastSummarizedAt ?? 0,
    };
  }

  async session(): Promise<Session> {
    const session: unknown = await this.db.json.get(this.sessionKey);

    return session as Session;
  }

  async length(): Promise<number> {
    const lengths = await this.db.json.arrLen(this.sessionKey, {
      path: "$.memories",
    });

    if (Array.isArray(lengths)) {
      return lengths[0] ?? 0;
    }

    return lengths;
  }

  async memories(): Promise<ShortTermMemory[]> {
    const memories: unknown = await this.db.json.get(this.sessionKey, {
      path: "$.memories",
    });

    if (Array.isArray(memories)) {
      if (Array.isArray(memories[0])) {
        return memories[0] as ShortTermMemory[];
      } else {
        return memories as ShortTermMemory[];
      }
    }

    return [];
  }

  async top(): Promise<ShortTermMemory | null> {
    const length = await this.length();

    if (length === 0) {
      return null;
    }

    const last = (await this.db.json.get(this.sessionKey, {
      path: `$.memories[${length - 1}]`,
    })) as unknown;

    if (Array.isArray(last)) {
      return last[0] as ShortTermMemory;
    }

    return last as ShortTermMemory | null;
  }

  async push(newMemory: CreateMemory): Promise<ShortTermMemory> {
    const memory = {
      id: this.options.createUid(),
      role: newMemory.role,
      content: newMemory.content,
      timestamp: Date.now(),
    };

    await this.db.json.arrAppend(this.sessionKey, "$.memories", memory);

    if (this.options.ttl && this.options.ttl > 0) {
      await this.db.persist(this.sessionKey);
      await this.db.expire(this.sessionKey, this.options.ttl);
    }

    return memory;
  }

  async clear(): Promise<void> {
    await this.db.json.clear(this.sessionKey, {
      path: "$.memories",
    });
  }

  async remove(): Promise<void> {
    await this.db.json.del(this.sessionKey);
  }

  private async createIfNotExists(): Promise<Session> {
    const exists = await this.db.exists(this.sessionKey);
    const session: Session = exists
      ? ((await this.db.json.get(this.sessionKey)) as unknown as Session)
      : {
          userId: this.userId,
          sessionId: this.sessionId,
          summary: "",
          lastSummarizedAt: Date.now(),
          memories: [],
        };

    if (!exists) {
      await this.db.json.set(this.sessionKey, "$", session as any);

      if (this.options.ttl && this.options.ttl > 0) {
        await this.db.expire(this.sessionKey, this.options.ttl);
      }
    }

    return session;
  }
}

export default ShortTermMemoryModel;
