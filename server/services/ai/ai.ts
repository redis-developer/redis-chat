import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModelV2, EmbeddingModelV2 } from "@ai-sdk/provider";
import { generateText, embed, stepCountIs, ModelMessage, Tool, ToolSet } from "ai";
import config from "../../config";
import type { ChatMessage } from "../../components/memory";

/**
 * Returns the configured LLM based on the environment settings.
 */
function getLlm() {
  let chat: LanguageModelV2 | null = null;
  let embeddings: EmbeddingModelV2<string> | null = null;
  let summaryEmbeddings: EmbeddingModelV2<string> | null = null;
  let dimensions: number | null = null;
  let summaryDimensions: number | null = null;

  if (config.anthropic.API_KEY && config.anthropic.API_KEY.length > 0) {
    chat = createAnthropic({ apiKey: config.anthropic.API_KEY })(
      config.anthropic.CHAT_MODEL,
    );
  }

  if (config.openai.API_KEY && config.openai.API_KEY.length > 0) {
    const openai = createOpenAI({
      apiKey: config.openai.API_KEY,
    });

    embeddings = embeddings ?? openai.embedding(config.openai.EMBEDDINGS_MODEL);
    summaryEmbeddings = summaryEmbeddings ?? openai.embedding(config.openai.SUMMARY_EMBEDDINGS_MODEL);
    dimensions = dimensions ?? config.openai.EMBEDDINGS_DIMENSIONS;
    summaryDimensions = summaryDimensions ?? config.openai.SUMMARY_EMBEDDINGS_DIMENSIONS;
    chat = chat ?? openai(config.openai.CHAT_MODEL);
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
    summaryEmbeddings = summaryEmbeddings ?? vertex.textEmbeddingModel(config.google.SUMMARY_EMBEDDINGS_MODEL);
    dimensions = dimensions ?? config.google.EMBEDDINGS_DIMENSIONS;
    summaryDimensions = summaryDimensions ?? config.google.SUMMARY_EMBEDDINGS_DIMENSIONS;
    chat = chat ?? vertex(config.google.CHAT_MODEL);
  }

  if (!chat || !embeddings || !dimensions || !summaryEmbeddings || !summaryDimensions) {
    throw new Error(
      "No LLM configured. Please set the appropriate environment variables for Anthropic, OpenAI, or Google Vertex AI.",
    );
  }

  return {
    chat,
    embeddings,
    summaryEmbeddings,
    dimensions,
    summaryDimensions,
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

export async function embedSummary(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: llm.summaryEmbeddings,
    value: text,
  });

  return embedding;
}

export async function answerPrompt(
  messages: ChatMessage[],
  summary: string,
  tools: (Tool & { name: string })[],
): Promise<string> {
  let prompt = `
    The current date is ${new Date().toISOString()}
    Answer the latest user question to the best of your ability. The following tools are available to you:
    ${tools.map((tool) => {
      return tool.description;
    }).join("\n")}
  `;

  if (typeof summary === "string" && summary.length > 0) {
    prompt += `
    The chat messages have been condensed to save space, below is a summary including the important details from the chat history:

    <summary>
    ${summary}
    </summary>
  `;
  }

  const response = await generateText({
    model: llm.chat,
    messages: [
      {
        role: "system",
        content: prompt,
      },
      ...messages,
    ],
    tools: tools.reduce((result, tool) => {
      result[tool.name] = tool;

      return result;
    }, {} as ToolSet),
    stopWhen: [stepCountIs(10)],
  });

  return response.text;
}

export async function extract(systemPrompt: string, message: ChatMessage, tools: (Tool & { name: string })[]): Promise<unknown> {
  const response = await generateText({
    model: llm.chat,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      message,
    ],
    tools: tools.reduce((result, tool) => {
      result[tool.name] = tool;

      return result;
    }, {} as ToolSet),
    stopWhen: [stepCountIs(10)],
  });

  return response;
}

export async function summarize(messages: ChatMessage[], existingSummary: string, tools: (Tool & { name: string })[]) {
  let prompt = `
    The current date is ${new Date().toISOString()}
    **Analyze the input messages and generate 5 essential questions** that, when answered, comprehensively capture the main points and core meaning of the messages. Aim for questions that dig deeper into the content and avoid redundancy.

    **Guidelines for formulating questions**:

    - Address the central theme or argument.
    - Identify key supporting ideas.
    - Highlight important facts or evidence.
    - Reveal the user's purpose or perspective.
    - Explore any significant implications or conclusions.

    **Answer each question in detail**: Provide thorough, clear answers, maintaining a balance between depth and clarity.
    **Final summary**: Conclude with a one or two-sentence summary that encapsulates the core message of the text. Include a specific example to illustrate your point.

    You have the following tool available to you:
    ${tools.map((tool) => {
      return tool.description;
    }).join("\n")}
  `;

  if (typeof existingSummary === "string" && existingSummary.length > 0) {
    prompt += `
    **Existing summary**: Below is an existing summary that you should add onto based on the set of messages. Only add new questions, do not remove old questions and answers.

    <existing-summary>
    ${existingSummary}
    </existing-summary>`
  }

  const { text } = await generateText({
    model: llm.chat,
    messages: [
      {
        role: "system",
        content: prompt,
      },
      ...messages,
    ],
    tools: tools.reduce((result, tool) => {
      result[tool.name] = tool;

      return result;
    }, {} as ToolSet),
    stopWhen: [stepCountIs(5)],
  });

  return text;
}

export const llm = getLlm();
