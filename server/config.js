import "dotenv/config";

const config = {
  env: {
    PROD: process.env.NODE_ENV === "production",
    PORT: process.env.PORT || 8080,
  },
  log: {
    LEVEL: process.env.LOG_LEVEL || "info",
    LOG_STREAM: process.env.LOG_STREAM || "LOG_STREAM",
    ERROR_STREAM: process.env.ERROR_STREAM || "ERROR_STREAM",
  },
  app: {
    FULL_NAME: process.env.APP_FULL_NAME || "Redis Chat",
    SERVICE_NAME: process.env.APP_SERVICE_NAME || "redis-chat",
    VERSION: process.env.APP_VERSION || "1.0.0",
  },
  anthropic: {
    API_KEY: process.env.ANTHROPIC_API_KEY || "",
    CHAT_MODEL: process.env.ANTHROPIC_CHAT_MODEL || "claude-3-5-sonnet-latest",
  },
  openai: {
    API_KEY: process.env.OPENAI_API_KEY || "",
    EMBEDDINGS_MODEL:
      process.env.OPENAI_EMBEDDINGS_MODEL || "text-embedding-3-small",
    EMBEDDINGS_DIMENSIONS: parseInt(
      process.env.OPENAI_EMBEDDINGS_DIMENSIONS ?? "1536",
      10,
    ),
  },
  redis: {
    URL: process.env.REDIS_URL || "redis://localhost:6379",
    SESSION_SECRET:
      process.env.REDIS_SESSION_SECRET || "default_session_secret",
    SESSION_PREFIX: process.env.REDIS_SESSION_PREFIX || "session:",
    CHAT_STREAM_PREFIX: process.env.REDIS_CHAT_STREAM_PREFIX || "chat:",
    CHAT_INDEX: process.env.REDIS_CHAT_INDEX || "idx:chat",
    CHAT_PREFIX: process.env.REDIS_CHAT_PREFIX || "qa:",
    MESSAGE_PREFIX: process.env.REDIS_MESSAGE_PREFIX || "message:",
  },
};

export default config;
