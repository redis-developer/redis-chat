/**
 * @param {KeyboardEvent} e 
 */
function submitPrompt(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    /** @type {HTMLTextAreaElement} */
    const textarea = e.currentTarget;
    /** @type {HTMLButtonElement} */
    const button = textarea.parentNode.querySelector("button");
    button.click();
  }
}
