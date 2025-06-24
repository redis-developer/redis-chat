import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, embed } from "ai";
import config from "../config";

const anthropic = createAnthropic({
  apiKey: config.anthropic.API_KEY,
});
const openai = createOpenAI({
  apiKey: config.openai.API_KEY,
});
const llm = {
  chat: anthropic(config.anthropic.CHAT_MODEL),
  embeddings: openai.embedding(config.openai.EMBEDDINGS_MODEL),
};

/**
 * Generates an embedding for the provided text using the configured LLM embeddings model.
 *
 * @param {string} text - The text to embed.
 *
 * @returns {Promise<Array<number>>} - The embedding vector for the text.
 */
export async function embedText(text) {
  const { embedding } = await embed({
    model: llm.embeddings,
    value: text,
  });

  return embedding;
}

const promptResponseSchema = z.object({
  response: z.string().describe("The response to the prompt"),
  canCacheResponse: z
    .boolean()
    .describe(
      "Is there an inferred prompt with which to cache the response? If so, return true. Otherwise, return false.",
    ),
  inferredPrompt: z.string().describe("The inferred prompt to cache"),
  cacheJustification: z
    .string()
    .describe("Justification for caching the result"),
  recommendedTtl: z
    .number()
    .default(-1)
    .describe(
      "If the prompt result should be cached, what is the recommended time-to-live in seconds for the cached value? Use -1 to cache forever.",
    ),
});

/**
 * @typedef {Object} CanCacheToolResponse
 * @property {string} response - The response to the prompt.
 * @property {boolean} canCacheResponse - Whether the response is cacheable.
 * @property {string} inferredPrompt - The inferred prompt that can be used to cache the response.
 * @property {string} cacheJustification - Justification for caching the response.
 * @property {number} recommendedTtl - Recommended time-to-live for the cached response in seconds.
 */

const promptResponseTool = /** @type {import("ai").Tool} */ ({
  description: `Given a prompt, answer the prompt and also tell me whether there is an inferred prompt with which to cache the answer. If you can infer a prompt that will answer the question without needing the chat history then it is cacheable. Otherwise do not cache it. For example,
    1. "What's the weather like in Paris?" is cacheable because it can be answered with a simple prompt like "Get the weather in Paris".
    2. "What did I say about the project yesterday?" is not cacheable because it requires context from the chat history.
    3. "When was Prince William born?" is cacheable and a follow up of "When was Harry born?" is also cacheable because it can be inferred to mean "When was Prince Harry born." and doesn't require chat history to answer the inferred question.`,
  parameters: promptResponseSchema,
});

/**
 * Gets a response from the LLM based on the provided prompt.
 *
 * @param {string} prompt - The prompt to send to the LLM.
 * @param {Array<import("ai").CoreMessage>} [messageHistory=[]] - The chat history to include in the prompt.
 *
 * @returns {Promise<CanCacheToolResponse>}
 */
export async function answerPrompt(prompt, messageHistory = []) {
  let toolResponse = /** @type {CanCacheToolResponse} */ ({
    canCacheResponse: false,
    inferredPrompt: prompt,
    cacheJustification: "No tool call found or invalid parameters",
    recommendedTtl: -1,
  });
  const { toolCalls } = await generateText({
    model: llm.chat,
    messages: [
      {
        role: "system",
        content:
          "Answer the latest user prompt to the best of your ability. Always call the `promptResponseTool` with your response to the prompt and the information about whether it is cacheable.",
      },
      ...messageHistory,
      { role: "user", content: prompt },
    ],
    tools: {
      promptResponseTool,
    },
    toolChoice: "required",
  });

  if (toolCalls.length > 0 && toolCalls[0]) {
    const toolCall = toolCalls[0];

    const parsed = promptResponseSchema.safeParse(toolCall.args);

    if (parsed.success) {
      toolResponse = parsed.data;
    }
  }

  if (!(toolResponse && toolResponse.response)) {
    throw new Error("LLM response is empty");
  }

  return toolResponse;
}
