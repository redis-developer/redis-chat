import markdownit from "markdown-it";

const md = markdownit({
  html: true,
  linkify: true,
  typographer: true,
});

function render({ id, message, isLocal }) {
  const markdown = md.render(message);
  if (isLocal) {
    return `<div id="${id}" class="flex items-start justify-end space-x-2">
      <div class="bg-blue-500 text-white p-3 rounded-xl max-w-lg">${markdown}</div>
    </div>`;
  }

  return `<div id="${id}" class="flex items-start space-x-2">
    <div class="bg-gray-200 p-3 rounded-xl max-w-lg">${markdown}</div>
  </div>`;
}

export function replaceMessage({ id, message, isLocal }) {
  const markdown = md.render(message);
  if (!isLocal) {
    return `
      <div id="${id}" hx-swap-oob="outerHTML:#${id}" class="flex items-start space-x-2">
        <div class="bg-gray-200 p-3 rounded-xl max-w-lg">${markdown}</div>
      </div>
    `;
  }
  return `
    <div id="${id}" hx-swap-oob="outerHTML:#${id}" class="flex items-start justify-end space-x-2">
      <div class="bg-blue-500 text-white p-3 rounded-xl max-w-lg">${markdown}</div>
    </div>
  `;
}

/**
 * Formats a message to be rendered in the chat interface.
 *
 * @param {Object} params - The parameters for rendering the message.
 * @param {string} params.message - The message content to render.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 */
export function renderMessage({ id, message, isLocal }) {
  const markdown = md.render(message);

  if (!isLocal) {
    return `
    <div hx-swap-oob="beforeend:#messages">
      <div id="${id}" class="flex items-start space-x-2">
        <div class="bg-gray-200 p-3 rounded-xl max-w-lg">${markdown}</div>
      </div>
    </div>
    `;
  }
  return `
  <div hx-swap-oob="beforeend:#messages">
    <div id="${id}" class="flex items-start justify-end space-x-2">
      <div class="bg-blue-500 text-white p-3 rounded-xl max-w-lg">${markdown}</div>
    </div>
  </div>
  `;
}
