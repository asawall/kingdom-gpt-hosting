// Copy Redis utility from API Gateway
const redis = require('redis');
const logger = require('./logger');

class RedisClient {
  constructor() {
    this.client = null;
  }

  async connect() {
    if (this.client) {
      return this.client;
    }

    try {
      this.client = redis.createClient({
        url: process.env.REDIS_URL,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis server connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            logger.error('Retry time exhausted');
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            logger.error('Too many retry attempts');
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.client.on('error', (err) => {
        logger.error('Redis Client Error:', err);
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready');
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      logger.error('Redis connection failed:', error);
      throw error;
    }
  }

  async get(key) {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis GET error:', error);
      return null;
    }
  }

  async set(key, value, expiration = null) {
    try {
      const stringValue = JSON.stringify(value);
      if (expiration) {
        await this.client.setEx(key, expiration, stringValue);
      } else {
        await this.client.set(key, stringValue);
      }
      return true;
    } catch (error) {
      logger.error('Redis SET error:', error);
      return false;
    }
  }

  async hSet(key, field, value) {
    try {
      await this.client.hSet(key, field, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error('Redis HSET error:', error);
      return false;
    }
  }

  async hGet(key, field) {
    try {
      const value = await this.client.hGet(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis HGET error:', error);
      return null;
    }
  }

  async publish(channel, message) {
    try {
      await this.client.publish(channel, JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error('Redis PUBLISH error:', error);
      return false;
    }
  }

  async quit() {
    if (this.client) {
      await this.client.quit();
      logger.info('Redis connection closed');
    }
  }
}

module.exports = new RedisClient();