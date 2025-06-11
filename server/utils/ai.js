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
 * Gets a response from the LLM based on the provided prompt.
 *
 * @param {string} prompt - The prompt to send to the LLM.
 */
export async function generateResponse(prompt) {
  const response = await generateText({
    model: llm.chat,
    messages: [
      { role: "system", content: "Answer the prompt using markdown" },
      { role: "user", content: prompt },
    ],
  });

  return response.text;
}
