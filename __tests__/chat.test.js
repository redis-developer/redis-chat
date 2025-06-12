import { afterAll, beforeAll, describe, test, mock, expect } from "bun:test";
import config from "../server/config.js";
import * as controller from "../server/components/chat/controller.js";
import * as store from "../server/components/chat/store.js";
import getClient from "../server/redis.js";

async function clean() {
  const redis = getClient();

  const exists = await store.haveIndex();
  if (exists) {
    await redis.ft.dropIndex(config.redis.CHAT_INDEX);
  }

  await redis.del([
    ...(await redis.keys(`${config.redis.CHAT_PREFIX}*`)),
    ...(await redis.keys(`${config.redis.CHAT_STREAM_PREFIX}*`)),
    ...(await redis.keys(`${config.redis.SESSION_PREFIX}*`)),
    config.log.ERROR_STREAM,
    config.log.LOG_STREAM,
  ]);
}

describe("Chats", () => {
  beforeAll(async () => {
    await clean();

    await controller.initialize();
  });

  afterAll(async () => {
    await clean();
  });

  test("A unique prompt should be answered", async () => {
    const send = mock(() => {});
    await controller.handleMessage(send, "test", "What year is it?");

    expect(send).toHaveBeenCalledTimes(3);
  });

  test("The same prompt twice should be exactly the same response", async () => {
    const send = mock(() => {});
    await controller.handleMessage(send, "test", "What year is it?");
    await controller.handleMessage(send, "test", "What year is it?");

    expect(send).toHaveBeenCalledTimes(6);
    expect(send.mock.calls[2][0].message).toBe(send.mock.calls[5][0].message);
  });
});
