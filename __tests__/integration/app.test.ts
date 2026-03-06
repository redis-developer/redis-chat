import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test";
import "../../server/redis.js";

mock.module("../../server/services/memory.js", () => ({
  memoryClient: {
    getOrCreateWorkingMemory: mock(() => Promise.resolve({ messages: [] })),
    putWorkingMemory: mock(() => Promise.resolve({})),
    deleteWorkingMemory: mock(() => Promise.resolve({ status: "ok" })),
    searchLongTermMemory: mock(() =>
      Promise.resolve({ memories: [], total: 0 }),
    ),
    memoryPrompt: mock(() => Promise.resolve({ messages: [] })),
  },
}));

import request from "supertest";
import app from "../../server/app.js";

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
