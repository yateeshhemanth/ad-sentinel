const Redis  = require("ioredis");
const logger = require("./logger");

let client;

const connectRedis = async () => {
  client = new Redis({
    host:     process.env.REDIS_HOST     || "adsentinel-redis",
    port:     parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  // Polyfill for ioredis versions that don't expose GETDEL as a method
  // (GETDEL was added to Redis in v6.2.0; ioredis wraps it automatically in v5+)
  if (!client.getdel) {
    client.getdel = async (key) => {
      const val = await client.get(key);
      if (val !== null) await client.del(key);
      return val;
    };
  }

  client.on("connect", () => logger.info("Redis connected"));
  client.on("error",   (e) => logger.error("Redis error:", e.message));
};

const getClient = () => client;

module.exports = { connectRedis, getClient };
