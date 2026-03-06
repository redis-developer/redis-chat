import { MemoryAPIClient } from "agent-memory-client";
import config from "../config.js";

export const memoryClient = new MemoryAPIClient({
  baseUrl: config.agentMemory.BASE_URL,
});
