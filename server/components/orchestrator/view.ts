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
Handlebars.registerPartial(
  "instructions",
  fs.readFileSync(
    path.join(process.cwd(), "./views/partials/instructions.hbs"),
    "utf8",
  ),
);
Handlebars.registerPartial(
  "chat/message",
  fs.readFileSync(
    path.join(process.cwd(), "./views/partials/chat/message.hbs"),
    "utf8",
  ),
);
Handlebars.registerPartial(
  "chat/messages",
  fs.readFileSync(
    path.join(process.cwd(), "./views/partials/chat/messages.hbs"),
    "utf8",
  ),
);
Handlebars.registerPartial(
  "chat/sidebar/chats",
  fs.readFileSync(
    path.join(process.cwd(), "./views/partials/chat/sidebar/chats.hbs"),
    "utf8",
  ),
);

const viewsPath = path.join(process.cwd(), "./views/partials");
const instructionsTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "instructions.hbs"), "utf8"),
);
const chatMessagesTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "chat/messages.hbs"), "utf8"),
);
const chatMessageTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "chat/message.hbs"), "utf8"),
);
const chatSidebarTemplate = Handlebars.compile(
  fs.readFileSync(path.join(viewsPath, "chat/sidebar/chats.hbs"), "utf8"),
);

/**
 * Renders the instructions section.
 */
export function renderInstructions(
  data: {
    instructions: string;
    progress?: boolean;
  } = { instructions: "" },
) {
  return instructionsTemplate(data);
}

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

  return chatMessageTemplate({
    replaceId,
    id,
    content: highlightedMessage,
    role,
  });
}

/**
 * Clears all messages from the chat interface.
 */
export function clearMessages() {
  return chatMessagesTemplate({});
}

/**
 * Renders the chat history for the user.
 */
export function renderChats({
  chats,
  currentChatId,
}: {
  chats: Array<{ chatId: string; message: string }>;
  currentChatId: string;
}) {
  return chatSidebarTemplate({
    chats,
    currentChatId,
  });
}
