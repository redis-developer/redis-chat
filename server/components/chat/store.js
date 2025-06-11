import getClient from "../../redis.js";

/**
 * Adds a chat message to the Redis stream for a given session.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @param {Object} params - The parameters for the chat message.
 * @param {string} params.message - The chat message content.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 */
export async function addChatMessage(sessionId, { message, isLocal }) {
  const client = getClient();

  try {
    await client.xAdd(`chat:${sessionId}`, "*", {
      timestamp: Date.now().toString(), // Store timestamp as string
      message: message,
      isLocal: isLocal.toString(),
    });
    console.log(`Message added to stream chat:${sessionId}`);
  } catch (error) {
    console.error(`Failed to add message to stream chat:${sessionId}:`, error);
    // Depending on requirements, you might want to re-throw or handle the error differently
    throw error;
  }
}

/**
 * Retrieves all chat messages from the Redis stream for a given session.
 *
 * @param {string} sessionId - The ID of the chat session.
 * @returns {Promise<Array<{ id: string, timestamp: number, message: string, isLocal: boolean }>>} - A promise resolving to an array of chat messages.
 */
export async function getChatMessages(sessionId) {
  const client = getClient();
  const streamKey = `chat:${sessionId}`;

  try {
    // '-' means the minimum possible ID, '+' means the maximum possible ID
    const streamEntries = await client.xRange(streamKey, "-", "+");

    const messages = streamEntries.map((entry) => {
      const { timestamp, message, isLocal } = entry.message;

      return {
        id: entry.id,
        timestamp: parseInt(timestamp, 10),
        message: message,
        isLocal: isLocal === "true",
      };
    });

    console.log(
      `Retrieved ${messages.length} messages from stream ${streamKey}`,
    );
    return messages;
  } catch (error) {
    console.error(
      `Failed to retrieve messages from stream ${streamKey}:`,
      error,
    );
    throw error;
  }
}
