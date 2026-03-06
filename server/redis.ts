import config from "./config.js";
import { createClient } from "redis";

if (!config.redis.URL) {
  console.error("REDIS_URL not set");
}

const redis = await createClient({ url: config.redis.URL })
  .on("error", (err) => {
    if (!config.env.TEST) {
      console.log("Redis Client Error", err);
    }
  })
  .connect();

export default redis;
