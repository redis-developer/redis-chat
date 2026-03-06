import session from "express-session";
import { RedisStore } from "connect-redis";
import redis from "../redis.js";
import config from "../config.js";

export async function getSessionParser() {
  const redisStore = new RedisStore({
    client: redis,
    prefix: config.redis.SESSION_PREFIX,
  });

  return session({
    store: redisStore,
    resave: false,
    saveUninitialized: true,
    secret: config.redis.SESSION_SECRET,
  });
}
