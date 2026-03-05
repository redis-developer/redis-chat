import { describe, test, expect, mock, beforeEach } from "bun:test";
import type {
  MemoryRecordResults,
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

mock.module("../server/services/memory", () => ({
  memoryClient: {
    searchLongTermMemory: mockSearchLongTermMemory,
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
  });
});
