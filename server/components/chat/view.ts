import Handlebars from "handlebars";
import type { HelperOptions } from "handlebars";
import hljs from "highlight.js";
import * as marked from "marked";
import fs from "fs";
import path from "path";

/**
 * Checks if two values are equal.
 */
function isEqual(options: HelperOptions) {
  const { a, b } = options.hash;

  return a === b;
}

function ifEqual(options: HelperOptions) {
  const { a, b } = options.hash;

  // @ts-ignore
  return a == b ? options.fn(this) : options.inverse(this);
}

/**
 * Converts markdown text to HTML.
 */
function markdown(options: HelperOptions) {
  const { md } = options.hash;

  return marked.parse(md);
}

Handlebars.registerHelper("markdown", markdown);
Handlebars.registerHelper("isEqual", isEqual);
Handlebars.registerHelper("ifEqual", ifEqual);

const viewsPath = path.join(process.cwd(), "./views/partials");
const messagesTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "chat/messages.hbs"), "utf8"),
);
const messageTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "chat/message.hbs"), "utf8"),
);
const chatsTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "sidebar/chats.hbs"), "utf8"),
);

/**
 * Formats a message to be rendered in the chat interface.
 */
export function renderMessage({
  replaceId,
  id,
  content,
  role,
}: {
  replaceId?: string;
  id: string;
  content: string;
  role?: "user" | "assistant";
}) {
  // Highlight code blocks in the message
  const highlightedMessage = content.replace(
    /```(.*?)\n([\s\S]*?)```/g,
    (match, lang, code) => {
      const validLang = hljs.getLanguage(lang) ? lang : "plaintext";
      const highlighted = hljs.highlight(code, { language: validLang }).value;
      return `<pre><code class="hljs ${validLang}">${highlighted}</code></pre>`;
    },
  );

  return messageTemplate({
    replaceId,
    id,
    content: highlightedMessage,
    role,
  });
}

/**
 * Clears all messages from the chat interface.
 */
export function clearMessages({
  placeholder = true,
}: { placeholder?: boolean } = {}) {
  return messagesTemplate({
    placeholder,
  });
}

/**
 * Renders the chat history for the user.
 */
export function renderChats({
  chats,
  currentSessionId,
}: {
  chats: Array<{ sessionId: string; message: string }>;
  currentSessionId: string;
}) {
  return chatsTemplate({
    chats,
    currentSessionId,
  });
}
