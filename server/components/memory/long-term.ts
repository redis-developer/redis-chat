const { createHash } = require('crypto');
import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from "redis";
import type { RediSearchSchema } from "redis";
import type { RedisClient } from "../../redis";
import { randomUlid } from "../../utils/uid";
import { float32ToBuffer } from "../../utils/convert";
import type { WithDistance } from "./types";
import { ChatMessage } from "./chat";
import { Tool } from "ai";
import z from "zod";
import dayjs from "dayjs";
import logger from "../../utils/log";

export interface LongTermMemoryEntry {
  id: string;
  userId?: string;
  sessionId?: string;
  memoryType: "semantic" | "episodic";
  topics: string[];
  entities: string[];
  memoryHash: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
  eventDate: string | null;
  question: string;
  text: string;
  questionEmbedding?: number[];
  textEmbedding?: number[];
}

export const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("The search query, could be phrased in the form of a question"),
  type: z
    .enum(["semantic", "episodic"])
    .describe(
      `The memory type to search through, either "episodic" or "semantic"`,
    ),
  requiresUserId: z.boolean().describe("For semantic memories: this value should be true when the memory is about a specific user, false otherwise"),
});

export type Search = z.infer<typeof searchSchema>;

export const extractedMemoriesSchema = z.object({
  memories: z.array(z.object({
    type: z
      .enum(["semantic", "episodic"])
      .describe(
        `The memory type, either "episodic" or "semantic"`,
      ),
    requiresUserId: z.boolean().describe("For semantic memories: this value should be true when the memory is about a specific user, false otherwise"),
    question: z.string().min(1).describe(`A question that you will ask to later retrieve the memory. For example, "What is the user's name?"`),
    text: z
      .string()
      .min(1)
      .describe(
        `The actual information to store (with all contextual references grounded)`,
      ),
    topics: z.array(z.string())
      .describe(
        `The topics of the memory (top 5)`,
      ),
    entities: z.array(z.string())
      .describe(
        `The entities of the memory`,
      ),
    eventDate: z.string().nullable().describe("For episodic memories, the date/time when the event occurred (ISO 8601 format), null for semantic memories")
  }))
});

export type ExtractedMemories = z.infer<typeof extractedMemoriesSchema>;
export type ExtractedMemory = ExtractedMemories["memories"][0];

export interface LongTermMemoryModelOptions {
  vectorDimensions?: number;
  createUid?(): string;
  embed?(text: string): Promise<number[]>;
  extract?(systemPrompt: string, message: ChatMessage, tools: (Tool & { name: string })[]): Promise<unknown>;
  distanceThreshold?: number;
  topK?: number;
}

const WORKING_MEMORY_EXTRACTION_PROMPT = `
  You are a memory extraction assistant. Your job is to analyze conversation
  messages and extract information that might be useful in future conversations.

  CONTEXTUAL GROUNDING REQUIREMENTS:
    When creating memories, you MUST resolve all contextual references to their concrete referents:

    1. PRONOUNS: Replace ALL pronouns (he/she/they/him/her/them/his/hers/theirs) with actual person names
       - "He prefers Python" → "User prefers Python" (if "he" refers to the user)
       - "Her expertise is valuable" → "User's expertise is valuable" (if "her" refers to the user)

    2. TEMPORAL REFERENCES: Convert relative time expressions to absolute dates/times
       - "yesterday" → "2024-03-15" (if today is March 16, 2024)
       - "last week" → "March 4-10, 2024" (if current week is March 11-17, 2024)

    3. SPATIAL REFERENCES: Resolve place references to specific locations
       - "there" → "San Francisco office" (if referring to SF office)
       - "here" → "the main conference room" (if referring to specific room)

    4. DEFINITE REFERENCES: Resolve definite articles to specific entities
       - "the project" → "the customer portal redesign project"
       - "the bug" → "the authentication timeout issue"

    MANDATORY: Never create memories with unresolved pronouns, vague time references, or unclear spatial references. Always ground contextual references using the full conversation context.

    MEMORY TYPES - SEMANTIC vs EPISODIC:

    There are two main types of long-term memories you can create:

    1. **SEMANTIC MEMORIES** (memoryType="semantic"):
       - General facts, knowledge, and user preferences that are timeless
       - Information that remains relevant across multiple conversations
       - User preferences, settings, and general knowledge
       - Examples:
         * "User prefers dark mode in all applications"
         * "User is a data scientist working with Python"
         * "User dislikes spicy food"
         * "The company's API rate limit is 1000 requests per hour"

    2. **EPISODIC MEMORIES** (memoryType="episodic"):
       - Specific events, experiences, or time-bound information
       - Things that happened at a particular time or in a specific context
       - MUST have a time dimension to be truly episodic
       - Should include an event_date when the event occurred
       - Examples:
         * "User visited Paris last month and had trouble with the metro"
         * "User reported a login bug on January 15th, 2024"
         * "User completed the onboarding process yesterday"
         * "User mentioned they're traveling to Tokyo next week"

    WHEN TO USE EACH TYPE:

    Use SEMANTIC for:
    - User preferences and settings
    - Skills, roles, and background information
    - General facts and knowledge
    - Persistent user characteristics
    - System configuration and rules

    Use EPISODIC for:
    - Specific events and experiences
    - Time-bound activities and plans
    - Historical interactions and outcomes
    - Contextual information tied to specific moments

  IMPORTANT RULES:
  1. Only extract information that would be genuinely useful for future interactions.
  2. Do not extract procedural knowledge or instructions.
  3. Return an empty list if no useful memories can be extracted.
`;

const schemaFields = [
  { name: "id", type: "tag" },
  { name: "sessionId", type: "tag" },
  { name: "userId", type: "tag" },
  { name: "memoryType", type: "tag" },
  { name: "topics", type: "tag" },
  { name: "entities", type: "tag" },
  { name: "memoryHash", type: "tag" },
  { name: "accessCount", type: "numeric" },
  { name: "createdAt", type: "numeric" },
  { name: "lastAccessed", type: "numeric" },
  { name: "updatedAt", type: "numeric" },
  { name: "eventDate", type: "numeric" },
  { name: "question", type: "text" },
  { name: "text", type: "text" },
];

function hash(memory: Partial<Pick<LongTermMemoryEntry, "text" | "userId" | "sessionId" | "memoryType">>): string {
  return createHash('sha256').update(JSON.stringify(memory)).digest('hex');
}

export class LongTermMemoryModel {
  static Key() {
    return "memory:longterm";
  }

  static Index() {
    return "idx-long-term-memory";
  }

  static async New(
    db: RedisClient,
    userId: string,
    options?: LongTermMemoryModelOptions,
  ) {
    return new LongTermMemoryModel(
      db,
      userId,
      await LongTermMemoryModel.Initialize(db, options),
    );
  }

  static async Initialize(
    db: RedisClient,
    options?: LongTermMemoryModelOptions,
  ): Promise<Required<LongTermMemoryModelOptions>> {
    const requiredOptions = await LongTermMemoryModel.DefaultOptions(options);

    const schema: RediSearchSchema = schemaFields.reduce((s, field) => {
      let fieldType: keyof typeof SCHEMA_FIELD_TYPE;

      switch (field.type) {
        case "tag":
          fieldType = SCHEMA_FIELD_TYPE.TAG;
          break;
        case "numeric":
          fieldType = SCHEMA_FIELD_TYPE.NUMERIC;
          break;
        case "text":
          fieldType = SCHEMA_FIELD_TYPE.TEXT;
          break;
        default:
          fieldType = SCHEMA_FIELD_TYPE.TEXT;
          break;
      }

      s[`$.${field.name}`] = {
        type: fieldType,
        AS: field.name,
      };

      return s;
    }, {
      "$.questionEmbedding": {
        type: SCHEMA_FIELD_TYPE.VECTOR,
        TYPE: "FLOAT32",
        ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.HNSW,
        DIM: requiredOptions.vectorDimensions,
        DISTANCE_METRIC: "COSINE",
        AS: "questionEmbedding",
      },
      "$.textEmbedding": {
        type: SCHEMA_FIELD_TYPE.VECTOR,
        TYPE: "FLOAT32",
        ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.HNSW,
        DIM: requiredOptions.vectorDimensions,
        DISTANCE_METRIC: "COSINE",
        AS: "textEmbedding",
      }
    } as any);

    const memKey = LongTermMemoryModel.Key();
    const index = LongTermMemoryModel.Index();
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
        extract: () => {
          throw new Error("You must provide an extract function");
        },
        distanceThreshold: 0.12,
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

  async search({ query, type, requiresUserId }: Search): Promise<(LongTermMemoryEntry & WithDistance)[]> {
    const embedding = await this.options.embed(query);
    let search = [`=>[KNN ${this.options.topK} @questionEmbedding $BLOB AS distance]`];

    if (type === "semantic" && requiresUserId) {
      search.unshift(`@userId:${this.userId}`);
    } else {
      search.unshift("*");
    }

    logger.info(`Searching for long-term memories: ${search}`, {
      userid: this.userId,
      query,
      type,
      requiresUserId
    });

    let results = await this.db.ft.search(
      LongTermMemoryModel.Index(),
      search.join(""),
      {
        PARAMS: {
          BLOB: float32ToBuffer(embedding),
        },
        SORTBY: "distance",
        DIALECT: 2,
        RETURN: schemaFields.map((field) => field.name).concat("distance"),
      },
    );

    if (results.total === 0) {
      search.pop();
      search.push(`=>[KNN ${this.options.topK} @textEmbedding $BLOB AS distance]`);

      results = await this.db.ft.search(
      LongTermMemoryModel.Index(),
      search.join(""),
      {
        PARAMS: {
          BLOB: float32ToBuffer(embedding),
        },
        SORTBY: "distance",
        DIALECT: 2,
        RETURN: schemaFields.map((field) => field.name).concat("distance"),
      },
    );
    }

    logger.info(`Found ${results.total} long-term memories: ${search}`, {
      userid: this.userId,
    });

    return results.documents
      .map((doc) => {
        return {
          ...doc.value,
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

  async extract(messages: ChatMessage[], sessionId: string) {
    let allMemories: LongTermMemoryEntry[] = [];

    logger.info(`Extracting long-term memories`, {
      userid: this.userId,
      messages,
    });

    const tool: Tool & { name: string } = Object.freeze({
      description: `
        - Call \`extract_memories\` to extract multiple memories from a given message.
      `,
      inputSchema: extractedMemoriesSchema,
      name: "extract_memories",
      execute: ({ memories }: ExtractedMemories) => {
        allMemories.push(...memories.map((memory) => {
          return {
            id: this.options.createUid(),
            userId: memory.requiresUserId ? this.userId : undefined,
            sessionId: memory.requiresUserId ? sessionId : undefined,
            memoryType: memory.type,
            topics: memory.topics,
            entities: memory.entities,
            memoryHash: hash({
              memoryType: memory.type,
              sessionId: memory.requiresUserId ? sessionId : undefined,
              text: memory.text,
              userId: memory.requiresUserId ? this.userId : undefined,
            }),
            accessCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            eventDate: memory.eventDate ? dayjs(memory.eventDate).toISOString() : null,
            question: memory.question,
            text: memory.text,
          };
        }))
      },
    });

    for (const message of messages) {
      if (message.extracted === "t") {
        continue;
      }

      await this.options.extract(WORKING_MEMORY_EXTRACTION_PROMPT, message, [tool]);
    }

    if (allMemories.length === 0) {
      return;
    }

    logger.info(`${allMemories.length} long-term memories extracted`, {
      userid: this.userId,
    });

    await Promise.all(allMemories.map(async (memory) => {
      memory.textEmbedding = await this.options.embed(memory.text);
      memory.questionEmbedding = await this.options.embed(memory.question);
    }));

    await this.db.json.mSet(allMemories.map((memory) => {
      return {
        key: `${LongTermMemoryModel.Key()}:${memory.id}`,
        path: "$",
        value: memory as any,
      };
    }));
  }

  async add(memory: LongTermMemoryEntry) {
    const embedding = await this.options.embed(memory.text);
    const key = `${LongTermMemoryModel.Key()}:${memory.id}`;

    await this.db.json.set(key, "$", {
      ...memory,
      embedding,
    });

    return memory.id;
  }

  getSearchTool(): Tool & { name: string } {
    const searchTool: Tool & { name: string } = Object.freeze({
      description: `
      - Call the \`search_memory\` tool if you need to search user memory for relevant information. 
        - Appropriate times to use the \`search_memory\` tool include:
            - If you cannot answer the prompt without information that is based on the user's past interactions.
            - If the user has asked a prompt that requires context from previous interactions.
            - If are unable to answer the prompt based on the current context, but you think the answer could exist in memory.
        - Types of user memory include:
            1. **SEMANTIC MEMORIES** (type="semantic"):
              - General facts, knowledge, and user preferences that are timeless
              - Information that remains relevant across multiple conversations
              - User preferences, settings, and general knowledge
              - Examples:
                * "User prefers dark mode in all applications"
                * "User is a data scientist working with Python"
                * "User dislikes spicy food"
                * "The company's API rate limit is 1000 requests per hour"
            2. **EPISODIC MEMORIES** (type="episodic"):
              - Specific events, experiences, or time-bound information
              - Things that happened at a particular time or in a specific context
              - MUST have a time dimension to be truly episodic
              - Should include an event_date when the event occurred
              - Examples:
                * "User visited Paris last month and had trouble with the metro"
                * "User reported a login bug on January 15th, 2024"
                * "User completed the onboarding process yesterday"
                * "User mentioned they're traveling to Tokyo next week"
        - When answering the prompt, if you have obtained relevant information from memory using the \`search_memory\` tool, use that information to construct your answer.
        - If you do not know how to answer the prompt, formulate a query and call the \`search_memory\` tool
      `,
      inputSchema: searchSchema,
      name: "search_memory",
      execute: async (query: Search) => {
        const result = await this.search(query);

        return result;
      },
    });

    return searchTool;
  }
}
