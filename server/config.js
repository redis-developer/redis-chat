import "dotenv/config";

const config = {
  env: {
    PORT: process.env.PORT || 8080,
  },
  anthropic: {
    API_KEY: process.env.ANTHROPIC_API_KEY || "",
    CHAT_MODEL: process.env.ANTHROPIC_CHAT_MODEL || "claude-3-5-sonnet-latest",
  },
  openai: {
    API_KEY: process.env.OPENAI_API_KEY || "",
    EMBEDDINGS_MODEL: process.env.OPENAI_EMBEDDINGS_MODEL || "text-embedding-3-small",
    EMBEDDINGS_DIMENSIONS: parseInt(process.env.OPENAI_EMBEDDINGS_DIMENSIONS, 10) || 1536,
  },
  redis: {
    URL: process.env.REDIS_URL || "redis://localhost:6379",
    SESSION_SECRET: process.env.REDIS_SESSION_SECRET || "default_session_secret",
    CHAT_INDEX: process.env.REDIS_CHAT_INDEX || "idx:chat",
    CHAT_PREFIX: process.env.REDIS_CHAT_PREFIX || "qa:",
  }
};

export default config;
