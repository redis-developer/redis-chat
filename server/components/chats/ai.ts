import { generateText, streamText, stepCountIs } from "ai";
import type { AsyncIterableStream, Tool } from "ai";
import { llm } from "../../services/ai/ai";
import type { ShortTermMemory, Tools } from "../../components/memory";

export function answerPrompt(
  messages: ShortTermMemory[],
  tools: Tools,
): AsyncIterableStream<string> {
  const { searchTool } = tools.getTools();
  const { textStream } = streamText({
    model: llm.largeModel,
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
                - Translate any user pronouns into the third person when searching in memory, e.g., "I" becomes "the user", "my" becomes "the user's", etc.

            - When answering the prompt, if you have obtained relevant information from memory using the \`${searchTool.name}\` tool, use that information to construct your answer.
            - If you don't obtain any information using the \`${searchTool.name}\` tool, or the \`${searchTool.name}\` tool returns nothing, answer the question to the best of your ability.
          `,
      },
      ...messages,
    ],
    tools: {
      [searchTool.name]: searchTool,
    },
    stopWhen: [stepCountIs(10)],
  });

  return textStream;
}

export async function storeMemories(
  query: string,
  response: string,
  tools: Tools,
) {
  const { addSemanticMemoryTool, addLongTermMemoryTool } = tools.getTools();

  await generateText({
    model: llm.mediumModel,
    system: `
      You are an AI assistant that extracts memories from a query and stores them for later retrieval.
      Create memory entries based on the following criteria:
      - The memory should be concise and to the point.
      - The memory should be something that could be useful to remember in the future.

      You have the following tools available:
      - \`${addSemanticMemoryTool.name}\`: ${addSemanticMemoryTool.description}
      - \`${addLongTermMemoryTool.name}\`: ${addLongTermMemoryTool.description}
      `,
    prompt: `
      INITIAL QUERY:
      ${query}

      RESPONSE:
      ${response}
      `,
    tools: {
      [addSemanticMemoryTool.name]: addSemanticMemoryTool,
      [addLongTermMemoryTool.name]: addLongTermMemoryTool,
    },
    stopWhen: [stepCountIs(5)],
  });
}
