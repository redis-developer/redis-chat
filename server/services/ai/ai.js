import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createVertex } from "@ai-sdk/google-vertex";
import { generateText, embed } from "ai";
import config from "../../config";
import {
  questionResponseTool,
  questionResponseSchema,
  getMemoryTool,
} from "./tools";

/**
 * Returns the configured LLM based on the environment settings.
 *
 * @returns {{ chat: import("@ai-sdk/provider").LanguageModelV1; embeddings: import("@ai-sdk/provider").EmbeddingModelV1<string>; dimensions: number; }} - The configured LLM instance.
 */
function getLlm() {
  /** @type {import("@ai-sdk/provider").LanguageModelV1 | null} */
  let chat = null;
  /** @type {import("@ai-sdk/provider").EmbeddingModelV1<string> | null} */
  let embeddings = null;
  /** @type {number | null} */
  let dimensions = null;

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

export const llm = getLlm();

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

/**
 * Gets a response from the LLM based on the provided question.
 *
 * @param {string} question - The question to send to the LLM.
 * @param {Array<import("ai").CoreMessage>} [messageHistory=[]] - The chat history to include in the question.
 * @param {(args: z.infer<typeof import("./tools").getMemorySchema>, options: import("ai").ToolExecutionOptions) => PromiseLike<string>} search - The function to execute the memory search tool.
 *
 * @returns {Promise<import("./tools").MemoryStoreToolResponse>} - The response from the LLM, including whether it can be stored in memory and where.
 */
export async function answerPrompt(question, search, messageHistory = []) {
  let toolResponse = /** @type {import("./tools").MemoryStoreToolResponse} */ ({
    storeInUserMemory: false,
    storeInSemanticMemory: false,
    userMemoryReasoning: "No tool call found or invalid parameters",
    semanticMemoryReasoning: "No tool call found or invalid parameters",
    inferredQuestion: question,
    recommendedTtl: -1,
  });
  const { toolCalls } = await generateText({
    model: llm.chat,
    messages: [
      {
        role: "system",
        content: `
            Answer the latest user question to the best of your ability. The following tools are available to you:

            - Call the \`questionResponseTool\` with your response to the question and the information about whether it can be stored in memory. Your answers can be stored in:
                - **User memory**: If the response is relevant to the user and can help in future interactions across different sessions.
                - **Semantic memory**: If the response is relevant to all users and can help in future interactions across all sessions.
                - Translate any user pronouns into the third person when storing in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
                - Don't translate pronouns when answering the question, only when storing in memory.
            - Call the \`searchUserMemory\` tool if you need to search user memory for relevant information. Appropriate times to use the \`searchUserMemory\` tool include:
                - If you cannot answer the question without information that is based on the user's past interactions.
                - If the user has asked a question that requires context from previous interactions.
                - If are unable to answer the question based on the current context, but you think the answer could exist in memory.
                - Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.
          `,
      },
      ...messageHistory,
      { role: "user", content: question },
    ],
    tools: {
      questionResponseTool,
      searchUserMemory: getMemoryTool(search),
    },
    toolChoice: "required",
    maxSteps: 10,
  });

  if (toolCalls.length > 0) {
    for (let toolCall of toolCalls) {
      if (toolCall.toolName !== "questionResponseTool") {
        continue;
      }

      const parsed = questionResponseSchema.safeParse(toolCall.args);

      if (parsed.success) {
        toolResponse = parsed.data;
        break;
      }
    }
  }

  if (!(toolResponse && toolResponse.response)) {
    throw new Error("LLM response is empty");
  }

  return toolResponse;
}
