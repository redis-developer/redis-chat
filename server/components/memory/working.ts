import type { RedisClient } from "../../redis";
import { randomUlid } from "../../utils/uid";
import LongTermMemoryModel from "./long";
import type { WithDistance } from "./types";
import type { LongTermMemoryEntry } from "./long";
import EpisodicMemoryModel from "./episodic";
import type { EpisodicMemoryEntry } from "./episodic";
import SemanticMemoryModel from "./semantic";
import type { SemanticMemoryEntry } from "./semantic";

export type SemanticWorkingMemoryEntry = SemanticMemoryEntry & {
  type: "semantic";
};

export type EpisodicWorkingMemoryEntry = EpisodicMemoryEntry & {
  type: "episodic";
};

export type LongTermWorkingMemoryEntry = LongTermMemoryEntry & {
  type: "long-term";
};

export type WorkingMemoryEntry =
  | SemanticWorkingMemoryEntry
  | EpisodicWorkingMemoryEntry
  | LongTermWorkingMemoryEntry;

export interface WorkingMemoryModelOptions {
  vectorDimensions?: number;
  createUid?(): string;
  embed?(text: string): Promise<number[]>;
  distanceThreshold?: number;
  topK?: number;
}

export class WorkingMemoryModel {
  static Key(userId: string) {
    return `users:u${userId}:memory:working`;
  }

  static Index(userId: string) {
    return `idx-${WorkingMemoryModel.Key(userId).replace(/:/g, "-")}`;
  }

  static async New(
    db: RedisClient,
    userId: string,
    options?: WorkingMemoryModelOptions,
  ) {
    const requiredOptions = await WorkingMemoryModel.DefaultOptions(options);
    const longTermMemoryModel = await LongTermMemoryModel.New(
      db,
      userId,
      requiredOptions,
    );
    const episodicMemoryModel = await EpisodicMemoryModel.New(
      db,
      userId,
      requiredOptions,
    );
    const semanticMemoryModel = await SemanticMemoryModel.New(
      db,
      requiredOptions,
    );

    return new WorkingMemoryModel(
      db,
      userId,
      requiredOptions,
      longTermMemoryModel,
      episodicMemoryModel,
      semanticMemoryModel,
    );
  }

  static async DefaultOptions(
    options?: WorkingMemoryModelOptions,
  ): Promise<Required<WorkingMemoryModelOptions>> {
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
      } as WorkingMemoryModelOptions,
      options,
    );

    let dim = options.vectorDimensions!;

    if (dim <= 0) {
      const embedding = await options.embed!("Hello, world!");
      dim = embedding.length;
      options.vectorDimensions = dim;
    }

    return options as Required<WorkingMemoryModelOptions>;
  }

  db: RedisClient;
  userId: string;
  options: Required<WorkingMemoryModelOptions>;

  longTermMemoryModel: LongTermMemoryModel;
  episodicMemoryModel: EpisodicMemoryModel;
  semanticMemoryModel: SemanticMemoryModel;

  constructor(
    db: RedisClient,
    userId: string,
    options: Required<WorkingMemoryModelOptions>,
    longTermMemoryModel: LongTermMemoryModel,
    episodicMemoryModel: EpisodicMemoryModel,
    semanticMemoryModel: SemanticMemoryModel,
  ) {
    this.db = db;
    this.userId = userId;
    this.options = options;
    this.longTermMemoryModel = longTermMemoryModel;
    this.episodicMemoryModel = episodicMemoryModel;
    this.semanticMemoryModel = semanticMemoryModel;
  }

  async search(query: string): Promise<(WorkingMemoryEntry & WithDistance)[]> {
    const [semanticResults, episodicMemoryResults, longTermResults] =
      await Promise.all([
        this.semanticMemoryModel.search(query),
        this.episodicMemoryModel.search(query),
        this.longTermMemoryModel.search(query),
      ]);

    const merged = [
      ...semanticResults.map((result) => {
        return {
          type: "semantic",
          ...result,
        } as WorkingMemoryEntry & WithDistance;
      }),
      ...episodicMemoryResults.map((result) => {
        return {
          type: "episodic",
          ...result,
        } as WorkingMemoryEntry & WithDistance;
      }),
      ...longTermResults.map((result) => {
        return {
          type: "long-term",
          ...result,
        } as WorkingMemoryEntry & WithDistance;
      }),
    ];
    merged.sort((a, b) => a.distance - b.distance);

    return merged;
  }

  async searchSemanticMemory(query: string) {
    return this.semanticMemoryModel.search(query);
  }

  async addSemanticMemory(question: string, answer: string, ttl?: number) {
    return this.semanticMemoryModel.add(question, answer, ttl);
  }

  async updateSemanticMemory(
    id: string,
    question: string,
    answer: string,
    ttl?: number,
  ) {
    return this.semanticMemoryModel.update(id, question, answer, ttl);
  }

  async addEpisodicMemory(chatId: string, summary: string, ttl?: number) {
    return this.episodicMemoryModel.add(chatId, summary, ttl);
  }

  async updateEpisodicMemory(chatId: string, summary: string, ttl?: number) {
    return this.episodicMemoryModel.update(chatId, summary, ttl);
  }

  async searchEpisodicMemory(query: string) {
    return this.episodicMemoryModel.search(query);
  }

  async addLongTermMemory(question: string, answer: string, ttl?: number) {
    return this.longTermMemoryModel.add(question, answer, ttl);
  }

  async updateLongTermMemory(
    id: string,
    question: string,
    answer: string,
    ttl?: number,
  ) {
    return this.longTermMemoryModel.update(id, question, answer, ttl);
  }
}

export default WorkingMemoryModel;
