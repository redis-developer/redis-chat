import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModelV2, EmbeddingModelV2 } from "@ai-sdk/provider";
import { generateText, embed, stepCountIs } from "ai";
import config from "../../config";
import { Tools } from "../../components/memory";
import type { ShortTermMemory } from "../../components/memory";

/**
 * Returns the configured LLM based on the environment settings.
 */
function getLlm() {
  let largeModel: LanguageModelV2 | null = null;
  let mediumModel: LanguageModelV2 | null = null;
  let smallModel: LanguageModelV2 | null = null;
  let embeddings: EmbeddingModelV2<string> | null = null;
  let dimensions: number | null = null;

  if (config.anthropic.API_KEY && config.anthropic.API_KEY.length > 0) {
    largeModel = createAnthropic({ apiKey: config.anthropic.API_KEY })(
      config.anthropic.LARGE_CHAT_MODEL,
    );
    mediumModel = createAnthropic({ apiKey: config.anthropic.API_KEY })(
      config.anthropic.MEDIUM_CHAT_MODEL,
    );
    smallModel = createAnthropic({ apiKey: config.anthropic.API_KEY })(
      config.anthropic.SMALL_CHAT_MODEL,
    );
  }

  if (config.openai.API_KEY && config.openai.API_KEY.length > 0) {
    const openai = createOpenAI({
      apiKey: config.openai.API_KEY,
    });

    embeddings = embeddings ?? openai.embedding(config.openai.EMBEDDINGS_MODEL);
    dimensions = dimensions ?? config.openai.EMBEDDINGS_DIMENSIONS;
    largeModel = largeModel ?? openai(config.openai.LARGE_CHAT_MODEL);
    mediumModel = mediumModel ?? openai(config.openai.MEDIUM_CHAT_MODEL);
    smallModel = smallModel ?? openai(config.openai.SMALL_CHAT_MODEL);
  }

  if (config.google.CREDENTIALS && config.google.CREDENTIALS.length > 0) {
    const vertex = createVertex({
      project: config.google.PROJECT_ID,
      location: config.google.LOCATION,
      googleAuthOptions: {
        credentials: JSON.parse(config.google.CREDENTIALS),
      },
    });

    embeddings =
      embeddings ?? vertex.textEmbeddingModel(config.google.EMBEDDINGS_MODEL);
    dimensions = dimensions ?? config.google.EMBEDDINGS_DIMENSIONS;
    largeModel = largeModel ?? vertex(config.google.LARGE_CHAT_MODEL);
    mediumModel = mediumModel ?? vertex(config.google.MEDIUM_CHAT_MODEL);
    smallModel = smallModel ?? vertex(config.google.SMALL_CHAT_MODEL);
  }

  if (!(largeModel && mediumModel && smallModel && embeddings && dimensions)) {
    throw new Error(
      "No LLM configured. Please set the appropriate environment variables for Anthropic, OpenAI, or Google Vertex AI.",
    );
  }

  return {
    largeModel,
    mediumModel,
    smallModel,
    embeddings,
    dimensions,
  };
}

/**
 * Generates an embedding for the provided text using the configured LLM embeddings model.
 */
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: llm.embeddings,
    value: text,
  });

  return embedding;
}

export const llm = getLlm();
