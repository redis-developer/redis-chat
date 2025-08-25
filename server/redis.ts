import config from "./config";
import { createClient } from "redis";
import type {
  RedisClientOptions,
  RedisClientType,
  RedisDefaultModules,
} from "redis";

if (!config.redis.URL) {
  console.error("REDIS_URL not set");
}

export type RedisClient = RedisClientType<RedisDefaultModules, {}, {}, 2, {}>;

let clients: Record<string, RedisClient> = {};
let maxRetries = 5;

let retries: Record<string, number> = {};
let connectionsRefused: Record<string, boolean> = {};

export default function getClient(options?: RedisClientOptions): RedisClient {
  options = Object.assign(
    {},
    {
      url: config.redis.URL,
    },
    options,
  );

  if (!options.url) {
    throw new Error("You must pass a URL to connect");
  }

  let client = clients[options.url];

  if (client) {
    return client;
  }

  try {
    client = createClient(options) as RedisClient;

    client
      .on("error", (err) => {
        const url = options.url ?? "";

        if (/ECONNREFUSED/.test(err.message)) {
          if (!connectionsRefused[url]) {
            connectionsRefused[url] = true;

            console.error("Redis Client Error", {
              error: err,
              noStream: true,
            });
          }
          return;
        }

        console.error("Redis Client Error", {
          error: err,
          noStream: true,
        });

        try {
          client.destroy();
        } catch (err) {}

        const clientRetries = retries[url] ?? 0;

        if (clientRetries < maxRetries) {
          retries[url] = clientRetries + 1;
          try {
            void refreshClient(client);
          } catch (e) {}
        }
      })
      .connect();

    clients[options.url] = client;

    return client;
  } catch (err) {
    console.error("Error creating Redis client:", {
      error: err,
      noStream: true,
    });

    throw err;
  }
}

async function refreshClient(client: RedisClient) {
  if (client) {
    const options = client.options;

    if (options?.url) {
      delete clients[options?.url];
    }

    getClient(options);
  }
}
