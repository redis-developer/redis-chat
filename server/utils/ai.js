import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, embed } from "ai";
import config from "../config.js";
import logger from "./log.js";

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

const shouldCacheToolSchema = z.object({
  shouldCacheResult: z
    .boolean()
    .describe(
      "Should this prompt result be cached? Don't cache any result that relies on the chat history.",
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

const shouldCacheTool = /** @type {import("ai").Tool} */ ({
  description:
    "Given a prompt, tell me whether the result should be cached and why. Also provide the inferred prompt to use to cache",
  parameters: shouldCacheToolSchema,
});

/**
 * Gets a response from the LLM based on the provided prompt.
 *
 * @param {string} prompt - The prompt to send to the LLM.
 * @param {Array<import("ai").CoreMessage>} [messageHistory=[]] - The chat history to include in the prompt.
 */
export async function answerPrompt(prompt, messageHistory = []) {
  logger.info(`Asking the LLM: ${prompt}`);
  const { text, toolCalls } = await generateText({
    model: llm.chat,
    messages: [
      {
        role: "system",
        content:
          "Answer the latest user prompt to the best of your ability. Always use the `shouldCache` tool to inform whether the response and prompt is cacheable. Respond with only the answer to the user's prompt, nothing related to tool calls.",
      },
      ...messageHistory,
      { role: "user", content: prompt },
    ],
    tools: {
      shouldCache: shouldCacheTool,
    },
    maxSteps: 2,
  });

  if (!text) {
    logger.error("LLM response is empty");
    throw new Error("LLM response is empty");
  }

  logger.info("Received LLM response");
  logger.debug(`LLM response: ${text}`);

  if (toolCalls.length > 0 && toolCalls[0]) {
    const toolCall = toolCalls[0];

    const parsed = shouldCacheToolSchema.safeParse(toolCall.args);

    if (parsed.success) {
      logger.debug("shouldCache tool called", parsed.data);
      return {
        text,
        shouldCacheResult: parsed.data.shouldCacheResult,
        inferredPrompt: parsed.data.inferredPrompt,
        cacheJustification: parsed.data.cacheJustification,
        recommendedTtl: parsed.data.recommendedTtl,
      };
    }
  }

  return {
    text,
    shouldCacheResult: false,
    inferredPrompt: prompt,
    cacheJustification: "No tool call found or invalid parameters",
    recommendedTtl: -1,
  };
}
