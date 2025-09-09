import session from "express-session";
import { RedisStore } from "connect-redis";
import getClient from "../redis";
import config from "../config";

export async function getSessionParser() {
  const redisStore = new RedisStore({
    client: await getClient(),
    prefix: config.redis.SESSION_PREFIX,
  });

  return session({
    store: redisStore,
    resave: false,
    saveUninitialized: true,
    secret: config.redis.SESSION_SECRET,
  });
}
