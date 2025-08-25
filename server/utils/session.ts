import session from "express-session";
import { RedisStore } from "connect-redis";
import getClient from "../redis";
import config from "../config";

const redisStore = new RedisStore({
  client: getClient(),
  prefix: config.redis.SESSION_PREFIX,
});

const sessionParser = session({
  store: redisStore,
  resave: false,
  saveUninitialized: true,
  secret: config.redis.SESSION_SECRET,
});

export default sessionParser;
