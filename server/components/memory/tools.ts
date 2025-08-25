import z from "zod";
import type { Tool } from "ai";
import WorkingMemoryModel from "./working";
import logger from "../../utils/log";

export const searchToolInput = z.object({
  query: z
    .string()
    .min(1)
    .describe("The search query, could be phrased in the form of a question"),
});

export const addMemoryToolInput = z.object({
  type: z
    .enum(["semantic", "long-term"])
    .describe(
      "For user-specific information that should be remembered over time, use 'long-term'. For general information that could apply to any user, use 'semantic'.",
    ),
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
  ttl: z
    .number()
    .optional()
    .describe(
      "If the question result should be stored, what is the recommended time-to-live in seconds for the stored value? Use -1 to store forever.",
    ),
});

export const updateMemoryToolInput = z.object({
  type: z
    .enum(["semantic", "long-term"])
    .describe(
      "For user-specific information that should be remembered over time, use 'long-term'. For general information that could apply to any user, use 'semantic'.",
    ),
  id: z.string().min(1).describe("The ID of the memory entry to update"),
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
  ttl: z
    .number()
    .optional()
    .describe(
      "If the question result should be stored, what is the recommended time-to-live in seconds for the stored value? Use -1 to store forever.",
    ),
});

export class Tools {
  static New(workingMemoryModel: WorkingMemoryModel) {
    return new Tools(workingMemoryModel);
  }

  chatId: string;
  workingMemoryModel: WorkingMemoryModel;

  constructor(workingMemoryModel: WorkingMemoryModel) {
    this.workingMemoryModel = workingMemoryModel;
  }

  getTools() {
    return {
      searchTool: this.getSearchTool(),
      addMemoryTool: this.getAddMemoryTool(),
      updateMemoryTool: this.getUpdateMemoryTool(),
    };
  }

  getSearchTool(): Tool & { name: string } {
    const searchTool: Tool & { name: string } = Object.freeze({
      description: `Search working memory for relevant information needed to answer the prompt. Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
      inputSchema: searchToolInput,
      name: "search_memory",
      execute: ({ query }) => {
        logger.info(`Searching memory for query: ${query}`, {
          userId: this.workingMemoryModel.userId,
        });

        return this.search(query);
      },
    });

    return searchTool;
  }

  getAddMemoryTool(): Tool & { name: string } {
    const addMemoryTool: Tool & { name: string } = Object.freeze({
      description: `Add a new memory entry to working memory. Use this to remember new information about the user or general information that could apply to any user. Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
      inputSchema: addMemoryToolInput,
      name: "add_memory",
      execute: ({ type, question, answer, ttl }) => {
        logger.info(`Adding "${question}" to ${type} memory`, {
          userId: this.workingMemoryModel.userId,
          question,
          answer,
          ttl,
        });
        return this.addMemory(type, question, answer, ttl);
      },
    });

    return addMemoryTool;
  }

  getUpdateMemoryTool(): Tool & { name: string } {
    const updateMemoryTool: Tool & { name: string } = Object.freeze({
      description: `Update an existing memory entry in working memory. Use this to update information about the user or general information that could apply to any user. Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
      inputSchema: updateMemoryToolInput,
      name: "update_memory",
      execute: ({ type, id, question, answer, ttl }) => {
        logger.info(`Updating question "${id}" in ${type} memory`, {
          userId: this.workingMemoryModel.userId,
          question,
          answer,
          ttl,
        });
        return this.updateMemory(type, id, question, answer, ttl);
      },
    });

    return updateMemoryTool;
  }

  async search(query: string) {
    const results = await this.workingMemoryModel.search(query, 1);

    if (results.length === 0) {
      return "";
    }

    const result = results[0];

    return result.type === "episodic" ? result.summary : result.answer;
  }

  async addMemory(
    type: "semantic" | "long-term",
    question: string,
    answer: string,
    ttl?: number,
  ) {
    if (type === "semantic") {
      return this.workingMemoryModel.addSemanticMemory(question, answer, ttl);
    } else if (type === "long-term") {
      return this.workingMemoryModel.addLongTermMemory(question, answer, ttl);
    } else {
      throw new Error(`Unknown memory type: ${type}`);
    }
  }

  async updateMemory(
    type: "semantic" | "long-term",
    id: string,
    question: string,
    answer: string,
    ttl?: number,
  ) {
    if (type === "semantic") {
      return this.workingMemoryModel.updateSemanticMemory(
        id,
        question,
        answer,
        ttl,
      );
    } else if (type === "long-term") {
      return this.workingMemoryModel.updateLongTermMemory(
        id,
        question,
        answer,
        ttl,
      );
    } else {
      throw new Error(`Unknown memory type: ${type}`);
    }
  }
}

export default Tools;
