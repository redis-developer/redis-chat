import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModelV2, EmbeddingModelV2 } from "@ai-sdk/provider";
import { generateText, embed, stepCountIs } from "ai";
import config from "../../config";
import { Tools } from "../../components/memory";
import type { ChatMessage } from "../../components/memory";

/**
 * Returns the configured LLM based on the environment settings.
 */
function getLlm() {
  let chat: LanguageModelV2 | null = null;
  let embeddings: EmbeddingModelV2<string> | null = null;
  let dimensions: number | null = null;

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
    dimensions = dimensions ?? config.openai.EMBEDDINGS_DIMENSIONS;
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
    dimensions = dimensions ?? config.google.EMBEDDINGS_DIMENSIONS;
    chat = chat ?? vertex(config.google.CHAT_MODEL);
  }

  if (!chat || !embeddings || !dimensions) {
    throw new Error(
      "No LLM configured. Please set the appropriate environment variables for Anthropic, OpenAI, or Google Vertex AI.",
    );
  }

  return {
    chat,
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

export async function answerPrompt(
  messages: ChatMessage[],
  tools: Tools,
): Promise<string> {
  const { addMemoryTool, searchTool, updateMemoryTool } = tools.getTools();

  const response = await generateText({
    model: llm.chat,
    messages: [
      {
        role: "system",
        content: `
            Answer the latest user question to the best of your ability. The following tools are available to you:
            - Call the \`${searchTool.name}\` tool if you need to search user memory for relevant information. 
                - Appropriate times to use the \`${searchTool.name}\` tool include:
                    - If you cannot answer the prompt without information that is based on the user's past interactions.
                    - If the user has asked a prompt that requires context from previous interactions.
                    - If are unable to answer the prompt based on the current context, but you think the answer could exist in memory.
                - Types of user memory include:
                    - **long-term**: Contains relevant information about the user such as their preferences and settings.
                    - **semantic**: Contains general knowledge that is relevant to all users such as, "Why is the sky blue?".
                    - **episodic**: Contains summaries of past interactions with the user.
                - Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
            - Call the \`${addMemoryTool.name}\` to add a memory that you might want to lookup later based on the prompt. The memory can be stored in:
                - **long-term**: If the memory is relevant to the user and can help in future interactions across different sessions.
                - **semantic**: If the memory is relevant to all users and can help in future interactions across all sessions.
                - Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
                - Don't translate pronouns when answering the question, only when storing in memory.
            - Call the \`${updateMemoryTool.name}\` to update an existing memory obtained from \`${searchTool.name}\` with a new value. The memory can be stored in:
                - **long-term**: If the memory is relevant to the user and can help in future interactions across different sessions.
                - **semantic**: If the memory is general knowledge relevant to anyone and can help in future interactions. You _must_ use semantic memory if possible.
                - Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
                - Don't translate pronouns when answering the question, only when storing in memory.
            
            - When answering the prompt, if you have obtained relevant information from memory using the \`${searchTool.name}\` tool, use that information to construct your answer.
            - Make sure you add any relevant information from the prompt to either "semantic" or "long-term" memory using the \`${addMemoryTool.name}\` tool so that you can lookup that information in future interactions.
            - Only use the tools with the latest message, do not use tools on prior messages.
          `,
      },
      ...messages,
    ],
    tools: {
      [searchTool.name]: searchTool,
      [addMemoryTool.name]: addMemoryTool,
      [updateMemoryTool.name]: updateMemoryTool,
    },
    stopWhen: [stepCountIs(10)],
  });

  return response.text;
}

export async function summarize() {}

export const llm = getLlm();
