import { describe, test, expect } from "bun:test";
import {
  renderMessage,
  clearMessages,
  renderChats,
} from "../../server/components/chats/view.js";

describe("chats/view", () => {
  describe("renderMessage", () => {
    test("renders a user message with correct id", () => {
      const html = renderMessage({
        id: "u-1",
        content: "Hello",
        role: "user",
      });
      expect(html).toContain("Hello");
      expect(html).toContain('id="entry-u-1"');
    });

    test("renders an assistant message", () => {
      const html = renderMessage({
        id: "a-1",
        content: "Hi!",
        role: "assistant",
      });
      expect(html).toContain("Hi!");
      expect(html).toContain('id="entry-a-1"');
    });

    test("renders with replaceId", () => {
      const html = renderMessage({
        id: "a-2",
        content: "Updated",
        role: "assistant",
        replaceId: "a-2",
      });
      expect(html).toContain("outerHTML:#entry-a-2");
    });

    test("highlights code blocks", () => {
      const content = '```python\nprint("hello")\n```';
      const html = renderMessage({
        id: "code-1",
        content,
        role: "assistant",
      });
      expect(html).toContain("hljs");
      expect(html).toContain("<pre><code");
    });

    test("uses plaintext for unrecognized language", () => {
      const content = "```foobar\nsome code\n```";
      const html = renderMessage({
        id: "code-2",
        content,
        role: "assistant",
      });
      expect(html).toContain("plaintext");
    });
  });

  describe("clearMessages", () => {
    test("returns non-empty HTML string", () => {
      const html = clearMessages();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain('id="messages"');
    });
  });

  describe("renderChats", () => {
    test("renders chat items", () => {
      const html = renderChats({
        chats: [{ chatId: "c1", message: "Chat one" }],
        currentChatId: "c1",
      });
      expect(html).toContain("Chat one");
      expect(html).toContain('value="c1"');
      expect(html).toContain('id="sidebarChats"');
    });

    test("renders multiple chats", () => {
      const html = renderChats({
        chats: [
          { chatId: "c1", message: "One" },
          { chatId: "c2", message: "Two" },
          { chatId: "c3", message: "Three" },
        ],
        currentChatId: "c2",
      });
      expect(html).toContain("One");
      expect(html).toContain("Two");
      expect(html).toContain("Three");
    });

    test("renders empty list", () => {
      const html = renderChats({
        chats: [],
        currentChatId: "none",
      });
      expect(html).toContain('id="sidebarChats"');
      expect(html).not.toContain("<li");
    });
  });
});
