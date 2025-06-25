import z from "zod";

/**
 * @typedef {Object} MemoryStoreToolResponse
 * @property {string} response - The response to the prompt.
 * @property {boolean} storeInLongTermMemory - Whether the response is suitable for user-based long-term memory.
 * @property {boolean} storeInGlobalMemory - Whether the response is suitable for global memory.
 * @property {string} inferredQuestion - The inferred prompt that can be used to cache the response.
 * @property {string} longTermMemoryJustification - Justification for caching the response.
 * @property {string} globalMemoryJustification - Justification for caching the response.
 * @property {number} recommendedTtl - Recommended time-to-live for the cached response in seconds.
 */

export const questionResponseSchema = z.object({
  response: z.string().describe("The response to the question"),
  storeInLongTermMemory: z
    .boolean()
    .describe(
      "Should this question response be cached in user-based short-term memory?",
    ),
  storeInGlobalMemory: z
    .boolean()
    .describe(
      "Should this question response be cached in user-independent global memory?",
    ),
  inferredQuestion: z
    .string()
    .describe(
      "The inferred question to cache. Always format it as a question.",
    ),
  longTermMemoryJustification: z
    .string()
    .describe(
      "Justification for caching the result in user-based long-term memory",
    ),
  globalMemoryJustification: z
    .string()
    .describe(
      "Justification for caching the result in user-independent global memory",
    ),
  recommendedTtl: z
    .number()
    .default(-1)
    .describe(
      "If the prompt result should be cached, what is the recommended time-to-live in seconds for the cached value? Use -1 to cache forever.",
    ),
});

export const questionResponseTool = /** @type {import("ai").Tool} */ ({
  description: `
    Given a prompt, answer the question and also tell me whether there is an inferred prompt with which to cache the answer. Your answers can be stored in short-term, long-term, or global memory.

    Here is how to determine whether your response should be cached in short-term, long-term, or global memory:

    - **Long-term memory**: If the response is relevant to the user and can help in future interactions across different sessions.
    - **Global memory**: If the response is relevant to all users and can help in future interactions across all sessions.

    Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
  `,
  parameters: questionResponseSchema,
});

/**
 * @typedef {Object} MemoryStoreTool
 * @property {string} question - The question to search for in the memory store
 * @property {boolean} longTermMemory - Whether to search long-term memory
 * @property {boolean} globalMemory - Whether to search global memory
 */

export const getMemorySchema = z.object({
  question: z.string().describe("The question to ask the memory store"),
  longTermMemory: z
    .boolean()
    .default(false)
    .describe("Whether to search long-term memory"),
  globalMemory: z
    .boolean()
    .default(false)
    .describe("Whether to search global memory"),
});

/**
 * Gets a memory tool for searching the memory store.
 *
 * @param {(args: z.infer<typeof getMemorySchema>, options: import("ai").ToolExecutionOptions) => PromiseLike<string>} execute - The function to execute the tool.
 */
export function getMemoryTool(execute) {
  return /** @type {import("ai").Tool} */ ({
    description: `Search the memory store for relevant information based on the question. You can specify whether to search long-term, or global memory. Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
    parameters: getMemorySchema,
    execute,
  });
}
