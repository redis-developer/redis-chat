/**
 * @param {KeyboardEvent} e
 */
function submitPrompt(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const textarea = /** @type {HTMLTextAreaElement} */ (e.currentTarget);
    const button = /** @type {HTMLButtonElement} */ (
      /** @type {HTMLElement} */ (textarea.parentNode).querySelector("button")
    );
    button.click();
  }
}
