import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import config from "../../config";

function getLlm() {
  let largeModel: LanguageModelV2 | null = null;
  let mediumModel: LanguageModelV2 | null = null;
  let smallModel: LanguageModelV2 | null = null;

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

    largeModel = largeModel ?? vertex(config.google.LARGE_CHAT_MODEL);
    mediumModel = mediumModel ?? vertex(config.google.MEDIUM_CHAT_MODEL);
    smallModel = smallModel ?? vertex(config.google.SMALL_CHAT_MODEL);
  }

  if (!(largeModel && mediumModel && smallModel)) {
    throw new Error(
      "No LLM configured. Please set the appropriate environment variables for Anthropic, OpenAI, or Google Vertex AI.",
    );
  }

  return {
    largeModel,
    mediumModel,
    smallModel,
  };
}

export const llm = getLlm();
