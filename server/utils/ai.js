import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, embed } from "ai";
import config from "../config.js";

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
  shouldCacheResult: z.boolean().describe("Whether the prompt result should be cached"),
  inferredPrompt: z.string().describe("The inferred prompt to cache"),
  cacheJustification: z.string().describe("Justification for caching the result"),
});

const shouldCacheTool = {
  description: "Given a prompt, tell me whether the result should be cached and why. Also provide the inferred prompt to use to cache",
  parameters: shouldCacheToolSchema,
};

/**
 * Determines whether a prompt result should be cached.
 *
 * @param {string} prompt - The prompt to evaluate.
 */
export async function shouldCache(prompt) {
  const { toolCalls } = await generateText({
    model: llm.chat,
    messages: [
      { role: "user", content: `Use the \`shouldCache\` tool to let me know if the following prompt is cachable:
Prompt: ${prompt}
` },
    ],
    tools: {
      shouldCache: shouldCacheTool,
    },
  });

  const toolCall = toolCalls?.[0];
  if (!toolCall) {
    throw new Error("No tool call found in the response");
  }

  if (toolCall.toolName !== "shouldCache") {
    throw new Error(`Expected tool call to be 'shouldCache', but got '${toolCall.name}'`);
  }

  const parsed = shouldCacheToolSchema.safeParse(toolCall.args);
  if (!parsed.success) {
    throw new Error(`Invalid tool call parameters: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Gets a response from the LLM based on the provided prompt.
 *
 * @param {string} prompt - The prompt to send to the LLM.
 */
export async function answerPrompt(prompt) {
  const { text, toolCalls } = await generateText({
    model: llm.chat,
    messages: [
      { role: "system", content: "Answer the prompt using markdown, use the `shouldCache` tool to tell me if the prompt and your response are worth caching." },
      { role: "user", content: prompt },
    ],
    tools: {
      shouldCache: shouldCacheTool
    }
  });

  const toolCall = toolCalls?.[0];

  const parsed = shouldCacheToolSchema.safeParse(toolCall.args);

  if (parsed.success) {
    return {
      text,
      shouldCacheResult: parsed.data.shouldCacheResult,
      inferredPrompt: parsed.data.inferredPrompt,
      cacheJustification: parsed.data.cacheJustification,
    }
  }

  return {
    text: response,
    shouldCacheResult: false,
    inferredPrompt: prompt,
    cacheJustification: "No tool call found or invalid parameters",
  };
}
