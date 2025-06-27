import Handlebars from "handlebars";
import hljs from "highlight.js";
import * as marked from "marked";
import fs from "fs";
import path from "path";

/**
 * Checks if two values are equal.
 *
 * @param {import("handlebars").HelperOptions} options - Handlebars options object.
 */
function isEqual(options) {
  const { chatId, currentChatId } = options.hash;
  // @ts-ignore
  return chatId == currentChatId ? options.fn(this) : options.inverse(this);
}
/**
 * Checks if two values are equal.
 *
 * @param {import("handlebars").HelperOptions} options - Handlebars options object.
 */
function markdown(options) {
  const { md } = options.hash;

  return marked.parse(md);
}

Handlebars.registerHelper("markdown", markdown);
Handlebars.registerHelper("isEqual", isEqual);

const viewsPath = path.join(process.cwd(), "./views/partials");
const messagesTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "messages.hbs"), "utf8"),
);
const messageTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "message.hbs"), "utf8"),
);
const chatsTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "chats.hbs"), "utf8"),
);

/**
 * Formats a message to be rendered in the chat interface.
 *
 * @param {Object} params - The parameters for rendering the message.
 * @param {string} [params.replaceId] - The ID of the message to replace.
 * @param {string} params.id - The unique ID of the message.
 * @param {string} params.message - The message content to render.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 */
export function renderMessage({ replaceId, id, message, isLocal }) {
  return messageTemplate({
    replaceId,
    id,
    message,
    isLocal,
  });
}

/**
 * Clears all messages from the chat interface.
 *
 * @param {Object} [options] - Options for clearing messages.
 * @param {boolean} [options.placeholder] - If true, shows a placeholder message when there are no messages.
 */
export function clearMessages({ placeholder = true } = {}) {
  return messagesTemplate({
    placeholder,
  });
}

/**
 * Renders the chat history for the user.
 *
 * @param {Object} params - The parameters for rendering the chat history.
 * @param {Array<{ chatId: string; message: string; }>} params.chats - The list of chats to render.
 * @param {string} params.currentChatId - The ID of the currently active chat.
 */
export function renderChats({ chats, currentChatId }) {
  return chatsTemplate({
    chats,
    currentChatId,
  });
}
