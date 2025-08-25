import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from "redis";
import type { RediSearchSchema } from "redis";
import type { RedisClient } from "../../redis";
import { randomUlid } from "../../utils/uid";
import { float32ToBuffer } from "../../utils/convert";
import type { WithDistance } from "./types";

export interface LongTermMemoryEntry {
  id: string;
  question: string;
  answer: string;
}

export interface LongTermMemoryModelOptions {
  vectorDimensions?: number;
  createUid?(): string;
  embed?(text: string): Promise<number[]>;
  distanceThreshold?: number;
  topK?: number;
}

export class LongTermMemoryModel {
  static Key(userId: string) {
    return `users:u${userId}:memory:longterm`;
  }

  static Index(userId: string) {
    return `idx-${LongTermMemoryModel.Key(userId).replace(/:/g, "-")}`;
  }

  static async New(
    db: RedisClient,
    userId: string,
    options?: LongTermMemoryModelOptions,
  ) {
    return new LongTermMemoryModel(
      db,
      userId,
      await LongTermMemoryModel.Initialize(db, userId, options),
    );
  }

  static async Initialize(
    db: RedisClient,
    userId: string,
    options?: LongTermMemoryModelOptions,
  ): Promise<Required<LongTermMemoryModelOptions>> {
    const requiredOptions = await LongTermMemoryModel.DefaultOptions(options);

    const schema: RediSearchSchema = {
      "$.embedding": {
        type: SCHEMA_FIELD_TYPE.VECTOR,
        TYPE: "FLOAT32",
        ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.FLAT,
        DIM: requiredOptions.vectorDimensions,
        DISTANCE_METRIC: "L2",
        AS: "embedding",
      },
      "$.id": {
        type: SCHEMA_FIELD_TYPE.TAG,
        AS: "id",
      },
      "$.question": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "question",
      },
      "$.answer": {
        type: SCHEMA_FIELD_TYPE.TEXT,
        AS: "answer",
      },
    };

    const memKey = LongTermMemoryModel.Key(userId);
    const index = LongTermMemoryModel.Index(userId);
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
    options?: LongTermMemoryModelOptions,
  ): Promise<Required<LongTermMemoryModelOptions>> {
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
      } as LongTermMemoryModelOptions,
      options,
    );

    let dim = options.vectorDimensions!;

    if (dim <= 0) {
      const embedding = await options.embed!("Hello, world!");
      dim = embedding.length;
      options.vectorDimensions = dim;
    }

    return options as Required<LongTermMemoryModelOptions>;
  }

  db: RedisClient;
  userId: string;
  options: Required<LongTermMemoryModelOptions>;

  constructor(
    db: RedisClient,
    userId: string,
    options: Required<LongTermMemoryModelOptions>,
  ) {
    this.db = db;
    this.userId = userId;
    this.options = options;
  }

  async search(query: string): Promise<(LongTermMemoryEntry & WithDistance)[]> {
    const embedding = await this.options.embed(query);

    const results = await this.db.ft.search(
      LongTermMemoryModel.Index(this.userId),
      `*=>[KNN ${this.options.topK} @embedding $BLOB AS distance]`,
      {
        PARAMS: {
          BLOB: float32ToBuffer(embedding),
        },
        SORTBY: "distance",
        DIALECT: 2,
        RETURN: ["id", "question", "answer", "distance"],
      },
    );

    return results.documents
      .map((doc) => {
        return {
          id: doc.value.id,
          question: doc.value.question,
          answer: doc.value.answer,
          distance: parseFloat(doc.value.distance as string),
        } as LongTermMemoryEntry & WithDistance;
      })
      .filter((entry) => {
        return (
          !isNaN(entry.distance) &&
          entry.distance <= this.options.distanceThreshold
        );
      });
  }

  async add(question: string, answer: string, ttl?: number) {
    const existingResult = await this.search(question);

    if (existingResult.length > 0 && existingResult[0].distance === 0) {
      return this.update(existingResult[0].id, question, answer, ttl);
    }

    const embedding = await this.options.embed(question);
    const id = this.options.createUid();
    const key = `${LongTermMemoryModel.Key(this.userId)}:${id}`;

    await this.db.json.set(key, "$", {
      id,
      question,
      answer,
      embedding,
    });

    if (ttl && ttl > 0) {
      await this.db.expire(key, ttl);
    }

    return id;
  }

  async update(id: string, question: string, answer: string, ttl?: number) {
    const embedding = await this.options.embed(question);
    const key = `${LongTermMemoryModel.Key(this.userId)}:${id}`;

    await this.db.json.set(key, "$", {
      id,
      question,
      answer,
      embedding,
    });

    if (ttl && ttl > 0) {
      await this.db.expire(key, ttl);
    }

    return id;
  }
}

export default LongTermMemoryModel;
