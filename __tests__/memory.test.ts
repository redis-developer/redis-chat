import { describe, test, expect, mock, beforeEach } from "bun:test";
import type {
  MemoryRecordResults,
  WorkingMemoryResponse,
  AckResponse,
  MemoryRecord,
  SearchOptions,
  WorkingMemory,
} from "agent-memory-client";

const mockSearchLongTermMemory = mock<
  (options: SearchOptions) => Promise<MemoryRecordResults>
>();
const mockCreateLongTermMemory = mock<
  (memories: MemoryRecord[]) => Promise<AckResponse>
>();
const mockGetOrCreateWorkingMemory = mock<
  (
    sessionId: string,
    options?: Record<string, unknown>,
  ) => Promise<WorkingMemoryResponse>
>();
const mockPutWorkingMemory = mock<
  (
    sessionId: string,
    wm: Partial<WorkingMemory>,
    options?: Record<string, unknown>,
  ) => Promise<WorkingMemoryResponse>
>();
const mockDeleteWorkingMemory = mock<
  (sessionId: string) => Promise<AckResponse>
>();

mock.module("../server/services/memory", () => ({
  memoryClient: {
    searchLongTermMemory: mockSearchLongTermMemory,
    createLongTermMemory: mockCreateLongTermMemory,
    getOrCreateWorkingMemory: mockGetOrCreateWorkingMemory,
    putWorkingMemory: mockPutWorkingMemory,
    deleteWorkingMemory: mockDeleteWorkingMemory,
  },
}));

import { Tools } from "../server/components/memory/tools";

describe("Tools", () => {
  const userId = "test-user-123";

  beforeEach(() => {
    mockSearchLongTermMemory.mockReset();
    mockCreateLongTermMemory.mockReset();
  });

  describe("search", () => {
    test("returns empty string when no results found", async () => {
      mockSearchLongTermMemory.mockResolvedValue({
        memories: [],
        total: 0,
      });

      const tools = Tools.New(userId);
      const result = await tools.search("What is the user's name?");

      expect(result).toBe("");
      expect(mockSearchLongTermMemory).toHaveBeenCalledTimes(1);
    });

    test("returns the top result text when results exist", async () => {
      mockSearchLongTermMemory.mockResolvedValue({
        memories: [
          {
            id: "mem-1",
            text: "The user's name is Alice",
            dist: 0.1,
            memory_type: "semantic" as const,
          },
        ],
        total: 1,
      });

      const tools = Tools.New(userId);
      const result = await tools.search("What is the user's name?");

      expect(result).toBe("The user's name is Alice");
      expect(mockSearchLongTermMemory).toHaveBeenCalledTimes(1);
      const callArgs = mockSearchLongTermMemory.mock.calls[0][0];
      expect(callArgs.text).toBe("What is the user's name?");
    });
  });

  describe("addMemory (semantic)", () => {
    test("creates a long-term memory with no user_id for semantic type", async () => {
      mockCreateLongTermMemory.mockResolvedValue({ status: "ok" });

      const tools = Tools.New(userId);
      await tools.addMemory("semantic", "Why is the sky blue?", "Because of Rayleigh scattering");

      expect(mockCreateLongTermMemory).toHaveBeenCalledTimes(1);
      const memories = mockCreateLongTermMemory.mock.calls[0][0];
      expect(memories).toHaveLength(1);
      expect(memories[0].text).toContain("Why is the sky blue?");
      expect(memories[0].text).toContain("Because of Rayleigh scattering");
      expect(memories[0].memory_type).toBe("semantic");
      expect(memories[0].user_id).toBeUndefined();
    });
  });

  describe("addMemory (long-term)", () => {
    test("creates a long-term memory with user_id set", async () => {
      mockCreateLongTermMemory.mockResolvedValue({ status: "ok" });

      const tools = Tools.New(userId);
      await tools.addMemory("long-term", "What is the user's name?", "Alice");

      expect(mockCreateLongTermMemory).toHaveBeenCalledTimes(1);
      const memories = mockCreateLongTermMemory.mock.calls[0][0];
      expect(memories).toHaveLength(1);
      expect(memories[0].text).toContain("What is the user's name?");
      expect(memories[0].text).toContain("Alice");
      expect(memories[0].memory_type).toBe("semantic");
      expect(memories[0].user_id).toBe(userId);
    });
  });

  describe("getTools", () => {
    test("returns tool objects with correct names", () => {
      const tools = Tools.New(userId);
      const toolSet = tools.getTools();

      expect(toolSet.searchTool.name).toBe("search_memory");
      expect(toolSet.addSemanticMemoryTool.name).toBe("add_semantic_memory");
      expect(toolSet.addLongTermMemoryTool.name).toBe("add_long_term_memory");
    });

    test("search tool execute calls search", async () => {
      mockSearchLongTermMemory.mockResolvedValue({
        memories: [
          {
            id: "mem-1",
            text: "User likes hiking",
            dist: 0.05,
            memory_type: "semantic" as const,
          },
        ],
        total: 1,
      });

      const tools = Tools.New(userId);
      const { searchTool } = tools.getTools();
      const result = await searchTool.execute!({ query: "hobbies" }, {
        toolCallId: "tc-1",
        messages: [],
        abortSignal: undefined as unknown as AbortSignal,
      });

      expect(result).toBe("User likes hiking");
    });

    test("add semantic memory tool execute calls createLongTermMemory", async () => {
      mockCreateLongTermMemory.mockResolvedValue({ status: "ok" });

      const tools = Tools.New(userId);
      const { addSemanticMemoryTool } = tools.getTools();
      await addSemanticMemoryTool.execute!(
        { question: "What color is the sky?", answer: "Blue" },
        { toolCallId: "tc-2", messages: [], abortSignal: undefined as unknown as AbortSignal },
      );

      expect(mockCreateLongTermMemory).toHaveBeenCalledTimes(1);
    });

    test("add long-term memory tool execute calls createLongTermMemory with user_id", async () => {
      mockCreateLongTermMemory.mockResolvedValue({ status: "ok" });

      const tools = Tools.New(userId);
      const { addLongTermMemoryTool } = tools.getTools();
      await addLongTermMemoryTool.execute!(
        { question: "What is the user's favorite color?", answer: "Blue" },
        { toolCallId: "tc-3", messages: [], abortSignal: undefined as unknown as AbortSignal },
      );

      expect(mockCreateLongTermMemory).toHaveBeenCalledTimes(1);
      const memories = mockCreateLongTermMemory.mock.calls[0][0];
      expect(memories[0].user_id).toBe(userId);
    });
  });
});
