import { describe, test, expect, mock, beforeEach } from "bun:test";
import type {
  MemoryRecordResults,
  MemoryRecord,
  WorkingMemoryResponse,
  AckResponse,
  SearchOptions,
  WorkingMemory,
} from "agent-memory-client";

const mockSearchLongTermMemory = mock<
  (options: SearchOptions) => Promise<MemoryRecordResults>
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
const mockCreateLongTermMemory = mock<
  (records: MemoryRecord[]) => Promise<void>
>();

mock.module("../../server/services/memory", () => ({
  memoryClient: {
    searchLongTermMemory: mockSearchLongTermMemory,
    getOrCreateWorkingMemory: mockGetOrCreateWorkingMemory,
    putWorkingMemory: mockPutWorkingMemory,
    deleteWorkingMemory: mockDeleteWorkingMemory,
    createLongTermMemory: mockCreateLongTermMemory,
  },
}));

import { Tools } from "../../server/components/memory/tools";

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

  describe("getTools", () => {
    test("returns tool objects with correct names", () => {
      const tools = Tools.New(userId);
      const toolSet = tools.getTools();

      expect(toolSet.searchTool.name).toBe("search_memory");
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

    test("returns all three tool names", () => {
      const tools = Tools.New(userId);
      const toolSet = tools.getTools();

      expect(toolSet.searchTool.name).toBe("search_memory");
      expect(toolSet.addSemanticMemoryTool.name).toBe("add_semantic_memory");
      expect(toolSet.addLongTermMemoryTool.name).toBe("add_long_term_memory");
    });
  });

  describe("addMemory", () => {
    test("creates a semantic memory without user_id", async () => {
      mockCreateLongTermMemory.mockResolvedValue(undefined);

      const tools = Tools.New(userId);
      await tools.addMemory("semantic", "Why is the sky blue?", "Rayleigh scattering");

      expect(mockCreateLongTermMemory).toHaveBeenCalledTimes(1);
      const records = mockCreateLongTermMemory.mock.calls[0][0];
      expect(records).toHaveLength(1);
      expect(records[0].text).toBe("Q: Why is the sky blue?\nA: Rayleigh scattering");
      expect(records[0].memory_type).toBe("semantic");
      expect(records[0].user_id).toBeUndefined();
      expect(records[0].id).toBeDefined();
    });

    test("creates a long-term memory with user_id", async () => {
      mockCreateLongTermMemory.mockResolvedValue(undefined);

      const tools = Tools.New(userId);
      await tools.addMemory("long-term", "What is the user's name?", "Alice");

      expect(mockCreateLongTermMemory).toHaveBeenCalledTimes(1);
      const records = mockCreateLongTermMemory.mock.calls[0][0];
      expect(records).toHaveLength(1);
      expect(records[0].text).toBe("Q: What is the user's name?\nA: Alice");
      expect(records[0].memory_type).toBe("semantic");
      expect(records[0].user_id).toBe(userId);
    });
  });

  describe("addSemanticMemoryTool", () => {
    test("execute calls addMemory with semantic type", async () => {
      mockCreateLongTermMemory.mockResolvedValue(undefined);

      const tools = Tools.New(userId);
      const { addSemanticMemoryTool } = tools.getTools();
      const result = await addSemanticMemoryTool.execute!(
        { question: "What is 2+2?", answer: "4" },
        {
          toolCallId: "tc-2",
          messages: [],
          abortSignal: undefined as unknown as AbortSignal,
        },
      );

      expect(result).toBe("Added memory for question: What is 2+2?");
      expect(mockCreateLongTermMemory).toHaveBeenCalledTimes(1);
      const records = mockCreateLongTermMemory.mock.calls[0][0];
      expect(records[0].user_id).toBeUndefined();
    });
  });

  describe("addLongTermMemoryTool", () => {
    test("execute calls addMemory with long-term type", async () => {
      mockCreateLongTermMemory.mockResolvedValue(undefined);

      const tools = Tools.New(userId);
      const { addLongTermMemoryTool } = tools.getTools();
      await addLongTermMemoryTool.execute!(
        { question: "The user's favorite color?", answer: "Blue" },
        {
          toolCallId: "tc-3",
          messages: [],
          abortSignal: undefined as unknown as AbortSignal,
        },
      );

      expect(mockCreateLongTermMemory).toHaveBeenCalledTimes(1);
      const records = mockCreateLongTermMemory.mock.calls[0][0];
      expect(records[0].text).toBe(
        "Q: The user's favorite color?\nA: Blue",
      );
      expect(records[0].user_id).toBe(userId);
    });
  });
});
