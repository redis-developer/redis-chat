import * as Handlebars from "handlebars";
import fs from "fs";
import path from "path";

const viewsPath = path.join(process.cwd(), "./views/components/chat");
const messagesTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "messages.hbs"), "utf8"),
);
const messageTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "message.hbs"), "utf8"),
);

/**
 * Formats a message to be rendered in the chat interface.
 *
 * @param {Object} params - The parameters for rendering the message.
 * @param {string} [params.replaceId] - The ID of the message to replace.
 * @param {string} params.id - The unique ID of the message.
 * @param {string} params.message - The message content to render.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 * @param {boolean} [params.showRefresh=true] - Whether to show the refresh button for bot messages.
 */
export function renderMessage({
  replaceId,
  id,
  message,
  isLocal,
  showRefresh = true,
}) {
  return messageTemplate({
    replaceId,
    id,
    message,
    isLocal,
    showRefresh,
  });
}

/**
 * Clears all messages from the chat interface.
 */
export function clearMessages() {
  return messagesTemplate({});
}
