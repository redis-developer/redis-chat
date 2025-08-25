import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from "redis";
import type { RediSearchSchema } from "redis";
import type { RedisClient } from "../../redis";
import { randomUlid } from "../../utils/uid";
import { float32ToBuffer } from "../../utils/convert";
import type { WithDistance } from "./types";

export interface SemanticMemoryEntry {
  id: string;
  question: string;
  answer: string;
}

export interface SemanticMemoryModelOptions {
  vectorDimensions?: number;
  createUid?(): string;
  embed?(text: string): Promise<number[]>;
  distanceThreshold?: number;
  topK?: number;
}

export class SemanticMemoryModel {
  static Key() {
    return `semantic-memory`;
  }

  static Index() {
    return `idx-${SemanticMemoryModel.Key().replace(/:/g, "-")}`;
  }

  static async New(db: RedisClient, options?: SemanticMemoryModelOptions) {
    return new SemanticMemoryModel(
      db,
      await SemanticMemoryModel.Initialize(db, options),
    );
  }

  static async Initialize(
    db: RedisClient,
    options?: SemanticMemoryModelOptions,
  ): Promise<Required<SemanticMemoryModelOptions>> {
    const requiredOptions = await SemanticMemoryModel.DefaultOptions(options);

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

    const memKey = SemanticMemoryModel.Key();
    const index = SemanticMemoryModel.Index();
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
    options?: SemanticMemoryModelOptions,
  ): Promise<Required<SemanticMemoryModelOptions>> {
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
      } as SemanticMemoryModelOptions,
      options,
    );

    let dim = options.vectorDimensions!;

    if (dim <= 0) {
      const embedding = await options.embed!("Hello, world!");
      dim = embedding.length;
      options.vectorDimensions = dim;
    }

    return options as Required<SemanticMemoryModelOptions>;
  }

  db: RedisClient;
  options: Required<SemanticMemoryModelOptions>;

  constructor(db: RedisClient, options: Required<SemanticMemoryModelOptions>) {
    this.db = db;
    this.options = options;
  }

  async search(query: string): Promise<(SemanticMemoryEntry & WithDistance)[]> {
    const embedding = await this.options.embed(query);

    const results = await this.db.ft.search(
      SemanticMemoryModel.Index(),
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
        } as SemanticMemoryEntry & WithDistance;
      })
      .filter((entry) => {
        return (
          !isNaN(entry.distance) &&
          entry.distance <= this.options.distanceThreshold
        );
      });
  }

  async add(question: string, answer: string, ttl?: number) {
    const embedding = await this.options.embed(question);
    const id = this.options.createUid();
    const key = `${SemanticMemoryModel.Key()}:${id}`;

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
    const key = `${SemanticMemoryModel.Key()}:${id}`;

    const exists = await this.db.exists(key);

    if (!exists) {
      throw new Error(`Semantic memory entry ${id} does not exist`);
    }

    await this.db.json.set(key, "$", {
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

export default SemanticMemoryModel;
