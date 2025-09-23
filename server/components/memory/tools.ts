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

export const addSemanticMemoryToolInput = z.object({
  question: z
    .string()
    .min(1)
    .describe(`The question to use to retrieve the memory later.`),
  answer: z.string().min(1).describe(`The answer to the question.`),
  ttl: z
    .number()
    .optional()
    .describe(
      "If the question result should be stored, what is the recommended time-to-live in seconds for the stored value? Use -1 to store forever.",
    ),
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
  ttl: z
    .number()
    .optional()
    .describe(
      "If the question result should be stored, what is the recommended time-to-live in seconds for the stored value? Use -1 to store forever.",
    ),
});

export const updateMemoryToolInput = z.object({
  type: z
    .enum(["long-term"])
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
          userId: this.workingMemoryModel.userId,
        });

        return this.search(query);
      },
    });

    return searchTool;
  }

  getAddSemanticMemoryTool(): Tool & { name: string } {
    const addSemanticMemoryTool: Tool & { name: string } = Object.freeze({
      description: `Add a new memory entry to semantic memory. Use this tool to store general facts and knowledge the applies to everyone.`,
      inputSchema: addSemanticMemoryToolInput,
      name: "add_semantic_memory",
      execute: async ({ question, answer, ttl }) => {
        logger.info(`Adding "${question}" to semantic memory`, {
          userId: this.workingMemoryModel.userId,
        });
        await this.addMemory("semantic", question, answer, ttl);

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
      execute: ({ question, answer, ttl }) => {
        logger.info(`Adding "${question}" to long-term memory`, {
          userId: this.workingMemoryModel.userId,
          answer,
          ttl,
        });
        return this.addMemory("long-term", question, answer, ttl);
      },
    });

    return addMemoryTool;
  }

  async search(query: string) {
    const results = await this.workingMemoryModel.search(query);

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
}

export default Tools;
