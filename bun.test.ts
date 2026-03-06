import { beforeAll, afterAll } from "bun:test";
import { $ } from "bun";

beforeAll(async () => {
  // global setup
  await $`docker compose up redis -d`;
});

afterAll(async () => {
  // global teardown
  await $`docker compose down redis`;
});
