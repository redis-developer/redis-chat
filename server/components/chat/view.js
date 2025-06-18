/**
 * Replaces a message in the chat interface.
 *
 * @param {Object} params - The parameters for replacing the message.
 * @param {string} params.replaceId - The ID of the message to replace.
 * @param {string} params.id - The unique ID of the message.
 * @param {string} params.message - The new message content.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 * @param {boolean} [params.showRefresh=true] - Whether to show the refresh button for bot messages.
 */
export function replaceMessage({
  replaceId,
  id,
  message,
  isLocal,
  showRefresh = true,
}) {
  if (!isLocal) {
    return `
      <div id="entry-${id}" hx-swap-oob="outerHTML:#entry-${replaceId}" class="flex items-start space-x-2">
        <div class="flex bg-gray-200 p-3 rounded-xl max-w-lg">
          <div>${message}</div>
          ${
            showRefresh
              ? `<button
            hx-get="/chat/regenerate/${id}"
            hx-target="#entry-${id}"
            hx-disabled-elt="this"
            class="bg-gray-500 self-end h-10 text-white px-4 py-2 rounded-xl hover:bg-gray-600">
            ⟳
            </button>`
              : ""
          }
        </div>
      </div>
    `;
  }
  return `
    <div id="entry-${id}" hx-swap-oob="outerHTML:#entry-${replaceId}" class="flex items-start justify-end space-x-2">
      <div class="bg-blue-500 text-white p-3 rounded-xl max-w-lg">${message}</div>
    </div>
  `;
}

/**
 * Formats a message to be rendered in the chat interface.
 *
 * @param {Object} params - The parameters for rendering the message.
 * @param {string} params.id - The unique ID of the message to replace.
 * @param {string} params.message - The message content to render.
 * @param {boolean} params.isLocal - True if the message is from the local user, false if it's from the bot.
 * @param {boolean} [params.showRefresh=true] - Whether to show the refresh button for bot messages.
 */
export function renderMessage({ id, message, isLocal, showRefresh = true }) {
  if (!isLocal) {
    return `
    <div hx-swap-oob="beforeend:#messages">
      <div id="entry-${id}" class="flex items-start space-x-2">
        <div class="flex bg-gray-200 p-3 rounded-xl max-w-lg">
        <div>${message}</div>
        ${
          showRefresh
            ? `<button
          hx-get="/chat/regenerate/${id}"
          hx-target="#entry-${id}"
          hx-disabled-elt="this"
          class="bg-gray-500 self-end h-10 text-white px-4 py-2 rounded-xl hover:bg-gray-600">
          ⟳
          </button>`
            : ""
        }
        </div>
      </div>
    </div>
    `;
  }
  return `
  <div hx-swap-oob="beforeend:#messages">
    <div id="entry-${id}" class="flex items-start justify-end space-x-2">
      <div class="bg-blue-500 text-white p-3 rounded-xl max-w-lg">${message}</div>
    </div>
  </div>
  `;
}

export function clearMessages() {
  return `
    <main hx-swap-oob="outerHTML:#messages" id="messages" class="flex-1 overflow-y-auto p-4 space-y-4">
    </main>
  `;
}
