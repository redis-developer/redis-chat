import z from "zod";

/**
 * @typedef {Object} MemoryStoreToolResponse
 * @property {string} response - The response to the prompt.
 * @property {boolean} storeInUserMemory - Whether the response is suitable for user memory.
 * @property {boolean} storeInSemanticMemory - Whether the response is suitable for semantic memory.
 * @property {string} inferredQuestion - The inferred prompt that can be used to store the response.
 * @property {string} userMemoryReasoning - Reason for storing the response in user memory.
 * @property {string} semanticMemoryReasoning - Reason for storing the response in semantic memory.
 * @property {number} recommendedTtl - Recommended time-to-live for the stored response in seconds.
 */

export const questionResponseSchema = z.object({
  response: z.string().describe("The response to the question"),
  storeInUserMemory: z
    .boolean()
    .describe(
      "Should this question response be stored in user-based short-term memory?",
    ),
  storeInSemanticMemory: z
    .boolean()
    .describe(
      "Should this question response be stored in user-independent semantic memory?",
    ),
  inferredQuestion: z
    .string()
    .describe(
      "The inferred question to store. Always format it as a question.",
    ),
  userMemoryReasoning: z
    .string()
    .describe("Reason for storing the result in user-based user memory"),
  semanticMemoryReasoning: z
    .string()
    .describe(
      "Reason for storing the result in user-independent semantic memory",
    ),
  recommendedTtl: z
    .number()
    .default(-1)
    .describe(
      "If the prompt result should be stored, what is the recommended time-to-live in seconds for the stored value? Use -1 to store forever.",
    ),
});

export const questionResponseTool = /** @type {import("ai").Tool} */ ({
  description: `
    Given a prompt, answer the question and also tell me whether there is an inferred prompt with which to store the answer. Your answers can be stored in short-term, user, or semantic memory.

    Here is how to determine whether your response should be stored in short-term memory, user memory, or semantic memory:

    - **User memory**: If the response is relevant to the user and can help in future interactions across different sessions.
    - **Semantic memory**: If the response is relevant to all users and can help in future interactions across all sessions.

    Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
  `,
  parameters: questionResponseSchema,
});

/**
 * @typedef {Object} MemoryStoreTool
 * @property {string} question - The question to search for in the memory store
 * @property {boolean} userMemory - Whether to search user memory
 * @property {boolean} semanticMemory - Whether to search semantic memory
 */

export const getMemorySchema = z.object({
  question: z.string().describe("The question to ask the memory store"),
  userMemory: z
    .boolean()
    .default(false)
    .describe("Whether to search user memory"),
  semanticMemory: z
    .boolean()
    .default(false)
    .describe("Whether to search semantic memory"),
});

/**
 * Gets a memory tool for searching the memory store.
 *
 * @param {(args: z.infer<typeof getMemorySchema>, options: import("ai").ToolExecutionOptions) => PromiseLike<string>} execute - The function to execute the tool.
 */
export function getMemoryTool(execute) {
  return /** @type {import("ai").Tool} */ ({
    description: `Search the memory store for relevant information based on the question. You can specify whether to search user, or semantic memory. Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.`,
    parameters: getMemorySchema,
    execute,
  });
}
