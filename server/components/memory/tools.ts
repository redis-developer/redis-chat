import { z } from "zod";
import type { Tool } from "ai";
import type { MemoryRecord } from "agent-memory-client";
import { memoryClient } from "../../services/memory.js";
import { UserId } from "agent-memory-client";
import logger from "../../utils/log.js";

export const searchToolInput = z.object({
  query: z
    .string()
    .min(1)
    .describe("The search query, could be phrased in the form of a question"),
});

export const addSemanticMemoryToolInput = z.object({
  question: z
    .string()
    .min(1)
    .describe(`The question to use to retrieve the memory later.`),
  answer: z.string().min(1).describe(`The answer to the question.`),
});

export const addLongTermMemoryToolInput = z.object({
  question: z
    .string()
    .min(1)
    .describe(
      `The question to use to retrieve the memory later. Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
    ),
  answer: z
    .string()
    .min(1)
    .describe(
      `The answer to the question. Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
    ),
});

export class Tools {
  static New(userId: string) {
    return new Tools(userId);
  }

  userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  getTools() {
    return {
      searchTool: this.getSearchTool(),
      addSemanticMemoryTool: this.getAddSemanticMemoryTool(),
      addLongTermMemoryTool: this.getAddLongTermMemoryTool(),
    };
  }

  getSearchTool(): Tool & { name: string } {
    const searchTool: Tool & { name: string } = Object.freeze({
      description: `Search working memory for relevant information needed to answer the prompt. Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
      inputSchema: searchToolInput,
      name: "search_memory",
      execute: ({ query }) => {
        logger.info(`Searching memory for query: ${query}`, {
          userId: this.userId,
        });

        return this.search(query);
      },
    });

    return searchTool;
  }

  getAddSemanticMemoryTool(): Tool & { name: string } {
    const addSemanticMemoryTool: Tool & { name: string } = Object.freeze({
      description: `Add a new memory entry to semantic memory. Use this tool to store general facts and knowledge that applies to everyone.`,
      inputSchema: addSemanticMemoryToolInput,
      name: "add_semantic_memory",
      execute: async ({ question, answer }) => {
        logger.info(`Adding "${question}" to semantic memory`, {
          userId: this.userId,
        });
        await this.addMemory("semantic", question, answer);

        return `Added memory for question: ${question}`;
      },
    });

    return addSemanticMemoryTool;
  }

  getAddLongTermMemoryTool(): Tool & { name: string } {
    const addMemoryTool: Tool & { name: string } = Object.freeze({
      description: `Add a new memory entry to long-term memory. Use this to remember new information about the user. Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
      inputSchema: addLongTermMemoryToolInput,
      name: "add_long_term_memory",
      execute: ({ question, answer }) => {
        logger.info(`Adding "${question}" to long-term memory`, {
          userId: this.userId,
          answer,
        });
        return this.addMemory("long-term", question, answer);
      },
    });

    return addMemoryTool;
  }

  async search(query: string): Promise<string> {
    const results = await memoryClient.searchLongTermMemory({
      text: query,
      userId: new UserId({ eq: this.userId }),
      limit: 5,
    });

    if (results.memories.length === 0) {
      return "";
    }

    return results.memories[0].text;
  }

  async addMemory(
    type: "semantic" | "long-term",
    question: string,
    answer: string,
  ) {
    const text = `Q: ${question}\nA: ${answer}`;

    const record: MemoryRecord = {
      id: crypto.randomUUID(),
      text,
      memory_type: "semantic" as MemoryRecord["memory_type"],
      ...(type === "long-term" ? { user_id: this.userId } : {}),
    };

    await memoryClient.createLongTermMemory([record]);
  }
}

export default Tools;
