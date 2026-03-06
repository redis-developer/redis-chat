import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test";
import { createClient } from "redis";
import type { RedisClientType } from "redis";

mock.module("../../server/services/memory", () => ({
  memoryClient: {
    getOrCreateWorkingMemory: mock(() =>
      Promise.resolve({ messages: [] }),
    ),
    putWorkingMemory: mock(() => Promise.resolve({})),
    deleteWorkingMemory: mock(() => Promise.resolve({ status: "ok" })),
    searchLongTermMemory: mock(() =>
      Promise.resolve({ memories: [], total: 0 }),
    ),
    memoryPrompt: mock(() =>
      Promise.resolve({ messages: [] }),
    ),
  },
}));

import request from "supertest";
import app from "../../server/app";

let redis: RedisClientType;

beforeAll(async () => {
  redis = createClient({ url: "redis://localhost:6379" }) as RedisClientType;
  await redis.connect();
});

afterAll(async () => {
  await redis.quit();
});

describe("integration: Express app", () => {
  test("GET / returns 200 and renders HTML", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Redis Chat");
  });

  test("GET / sets a session cookie", async () => {
    const res = await request(app).get("/");
    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
    expect(cookieStr).toContain("connect.sid");
  });

  test("multiple independent requests all succeed", async () => {
    const res1 = await request(app).get("/");
    const res2 = await request(app).get("/");

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  test("static files are served from /public", async () => {
    const res = await request(app).get("/events.js");
    expect(res.status).toBe(200);
  });

  test("GET /nonexistent returns 404", async () => {
    const res = await request(app).get("/nonexistent");
    expect(res.status).toBe(404);
  });
});
