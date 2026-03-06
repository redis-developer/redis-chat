import { describe, test, expect } from "bun:test";
import {
  renderInstructions,
  renderMessage,
  clearMessages,
  renderChats,
} from "../../server/components/orchestrator/view.js";

describe("orchestrator/view", () => {
  describe("renderInstructions", () => {
    test("renders with default empty instructions", () => {
      const html = renderInstructions();
      expect(html).toContain('id="instructions"');
      expect(html).not.toContain("<progress");
    });

    test("renders with custom instructions text", () => {
      const html = renderInstructions({ instructions: "Ask anything" });
      expect(html).toContain("Ask anything");
    });

    test("renders with progress indicator", () => {
      const html = renderInstructions({
        instructions: "Loading",
        progress: true,
      });
      expect(html).toContain("<progress");
      expect(html).toContain("Loading");
    });
  });

  describe("renderMessage", () => {
    test("renders a user message", () => {
      const html = renderMessage({
        id: "msg-1",
        content: "Hello world",
        role: "user",
      });
      expect(html).toContain("Hello world");
      expect(html).toContain('id="entry-msg-1"');
      expect(html).toContain("hx-swap-oob");
    });

    test("renders an assistant message", () => {
      const html = renderMessage({
        id: "msg-2",
        content: "Hi there!",
        role: "assistant",
      });
      expect(html).toContain("Hi there!");
      expect(html).toContain('id="entry-msg-2"');
    });

    test("renders with replaceId for streaming updates", () => {
      const html = renderMessage({
        id: "msg-3",
        content: "Updated content",
        role: "assistant",
        replaceId: "msg-3",
      });
      expect(html).toContain("outerHTML:#entry-msg-3");
      expect(html).toContain("Updated content");
    });

    test("highlights code blocks in content", () => {
      const content = "```javascript\nconst x = 1;\n```";
      const html = renderMessage({
        id: "msg-4",
        content,
        role: "assistant",
      });
      expect(html).toContain("hljs");
      expect(html).toContain("<pre><code");
    });

    test("treats unknown language as plaintext", () => {
      const content = "```unknownlang\nsome code\n```";
      const html = renderMessage({
        id: "msg-5",
        content,
        role: "assistant",
      });
      expect(html).toContain("plaintext");
    });
  });

  describe("clearMessages", () => {
    test("returns HTML with messages container", () => {
      const html = clearMessages();
      expect(html).toContain('id="messages"');
      expect(html).toContain("hx-swap-oob");
    });
  });

  describe("renderChats", () => {
    test("renders a list of chats", () => {
      const html = renderChats({
        chats: [
          { chatId: "c1", message: "First chat" },
          { chatId: "c2", message: "Second chat" },
        ],
        currentChatId: "c1",
      });
      expect(html).toContain("First chat");
      expect(html).toContain("Second chat");
      expect(html).toContain('value="c1"');
      expect(html).toContain('value="c2"');
      expect(html).toContain('id="sidebarChats"');
    });

    test("renders empty list when no chats provided", () => {
      const html = renderChats({
        chats: [],
        currentChatId: "none",
      });
      expect(html).toContain('id="sidebarChats"');
      expect(html).not.toContain("<li");
    });
  });
});
