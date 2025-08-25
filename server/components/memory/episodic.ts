import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from "redis";
import type { RediSearchSchema } from "redis";
import type { RedisClient } from "../../redis";
import { randomUlid } from "../../utils/uid";
import { float32ToBuffer } from "../../utils/convert";
import type { WithDistance } from "./types";

export interface EpisodicMemoryEntry {
  summary: string;
  chatId: string;
}

export interface EpisodicMemoryModelOptions {
  vectorDimensions?: number;
  createUid?(): string;
  embed?(text: string): Promise<number[]>;
  distanceThreshold?: number;
  topK?: number;
}

export class EpisodicMemoryModel {
  static Key(userId: string) {
    return `users:u${userId}:memory:episodic`;
  }

  static Index(userId: string) {
    return `idx-${EpisodicMemoryModel.Key(userId).replace(/:/g, "-")}`;
  }

  static async New(
    db: RedisClient,
    userId: string,
    options?: EpisodicMemoryModelOptions,
  ) {
    return new EpisodicMemoryModel(
      db,
      userId,
      await EpisodicMemoryModel.Initialize(db, userId, options),
    );
  }

  static async Initialize(
    db: RedisClient,
    userId: string,
    options?: EpisodicMemoryModelOptions,
  ): Promise<Required<EpisodicMemoryModelOptions>> {
    const requiredOptions = await EpisodicMemoryModel.DefaultOptions(options);

    const schema: RediSearchSchema = {
      "$.embedding": {
        type: SCHEMA_FIELD_TYPE.VECTOR,
        TYPE: "FLOAT32",
        ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.FLAT,
        DIM: requiredOptions.vectorDimensions,
        DISTANCE_METRIC: "L2",
        AS: "embedding",
      },
      "$.summary": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "summary",
      },
      "$.chatId": {
        type: SCHEMA_FIELD_TYPE.TAG,
        AS: "chatId",
      },
    };

    const memKey = EpisodicMemoryModel.Key(userId);
    const index = EpisodicMemoryModel.Index(userId);
    const keys = await db.ft._list();

    if (keys.includes(index)) {
      return requiredOptions;
    }

    await db.ft.create(index, schema, {
      ON: "JSON",
      PREFIX: `${memKey}:`,
    });

    return requiredOptions;
  }

  private static async DefaultOptions(
    options?: EpisodicMemoryModelOptions,
  ): Promise<Required<EpisodicMemoryModelOptions>> {
    options = Object.assign(
      {},
      {
        vectorDimensions: -1,
        createUid: randomUlid,
        embed: async (text: string) => {
          throw new Error("You must provide an embed function");
        },
        distanceThreshold: 0.4,
        topK: 1,
      } as EpisodicMemoryModelOptions,
      options,
    );

    let dim = options.vectorDimensions!;

    if (dim <= 0) {
      const embedding = await options.embed!("Hello, world!");
      dim = embedding.length;
      options.vectorDimensions = dim;
    }

    return options as Required<EpisodicMemoryModelOptions>;
  }

  db: RedisClient;
  userId: string;
  options: Required<EpisodicMemoryModelOptions>;

  constructor(
    db: RedisClient,
    userId: string,
    options: Required<EpisodicMemoryModelOptions>,
  ) {
    this.db = db;
    this.userId = userId;
    this.options = options;
  }

  async search(query: string): Promise<(EpisodicMemoryEntry & WithDistance)[]> {
    const embedding = await this.options.embed(query);

    const results = await this.db.ft.search(
      EpisodicMemoryModel.Index(this.userId),
      `*=>[KNN ${this.options.topK} @embedding $BLOB AS distance]`,
      {
        PARAMS: {
          BLOB: float32ToBuffer(embedding),
        },
        SORTBY: "distance",
        DIALECT: 2,
        RETURN: ["summary", "chatId", "distance"],
      },
    );

    return results.documents
      .map((doc) => {
        return {
          summary: doc.value.summary,
          chatId: doc.value.chatId,
          distance: parseFloat(doc.value.distance as string),
        } as EpisodicMemoryEntry & WithDistance;
      })
      .filter((entry) => {
        return (
          !isNaN(entry.distance) &&
          entry.distance <= this.options.distanceThreshold
        );
      });
  }

  async add(chatId: string, summary: string, ttl?: number) {
    const embedding = await this.options.embed(summary);
    const id = this.options.createUid();
    const key = `${EpisodicMemoryModel.Key(this.userId)}:${id}`;

    await this.db.json.set(key, "$", {
      summary,
      chatId,
      embedding,
    });

    if (ttl && ttl > 0) {
      await this.db.expire(key, ttl);
    }

    return id;
  }

  async update(chatId: string, summary: string, ttl?: number) {
    const dbModel = await this.db.ft.search(
      EpisodicMemoryModel.Index(this.userId),
      `@chatId:{"${chatId}"}`,
      {
        LIMIT: {
          from: 0,
          size: 1,
        },
        RETURN: [],
      },
    );

    if (dbModel.total === 0) {
      return this.add(summary, chatId, ttl);
    }

    const { id } = dbModel.documents[0];
    const embedding = await this.options.embed(summary);

    await this.db.json.set(id, "$", {
      summary,
      chatId,
      embedding,
    });
  }
}

export default EpisodicMemoryModel;
