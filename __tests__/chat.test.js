import { afterAll, beforeAll, describe, test, mock, expect } from "bun:test";
import * as ctrl from "../server/components/chat/controller";
import * as store from "../server/components/chat/store";

describe("Chats", () => {
  beforeAll(async () => {
    await store.deleteKeys();
  });

  afterAll(async () => {
    // Comment out to persist data in Redis after tests
    await store.deleteKeys();
  });

  test("A unique prompt should be answered", async () => {
    const send = mock(() => {});
    await ctrl.handleMessage(send, "test", "What year is it?");

    expect(send).toHaveBeenCalledTimes(3);
  });

  test("The same prompt twice should be exactly the same response", async () => {
    const send = mock(() => {});
    await ctrl.handleMessage(send, "test", "Why is the sky blue?");
    await ctrl.handleMessage(send, "test", "Why is the sky blue?");

    expect(send).toHaveBeenCalled();
  });
});
