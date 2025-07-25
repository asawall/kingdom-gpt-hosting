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

  async del(key) {
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error('Redis DEL error:', error);
      return false;
    }
  }

  async exists(key) {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS error:', error);
      return false;
    }
  }

  async incr(key) {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error('Redis INCR error:', error);
      return null;
    }
  }

  async expire(key, seconds) {
    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      logger.error('Redis EXPIRE error:', error);
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

  async hGetAll(key) {
    try {
      const hash = await this.client.hGetAll(key);
      const result = {};
      for (const [field, value] of Object.entries(hash)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value;
        }
      }
      return result;
    } catch (error) {
      logger.error('Redis HGETALL error:', error);
      return {};
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

  async subscribe(channel, callback) {
    try {
      const subscriber = this.client.duplicate();
      await subscriber.connect();
      
      await subscriber.subscribe(channel, (message) => {
        try {
          const parsedMessage = JSON.parse(message);
          callback(parsedMessage);
        } catch (error) {
          logger.error('Error parsing Redis message:', error);
          callback(message);
        }
      });
      
      return subscriber;
    } catch (error) {
      logger.error('Redis SUBSCRIBE error:', error);
      return null;
    }
  }

  async quit() {
    if (this.client) {
      await this.client.quit();
      logger.info('Redis connection closed');
    }
  }

  // Cache management utilities
  async cacheUser(userId, userData, expiration = 3600) {
    return await this.set(`user:${userId}`, userData, expiration);
  }

  async getCachedUser(userId) {
    return await this.get(`user:${userId}`);
  }

  async invalidateUserCache(userId) {
    return await this.del(`user:${userId}`);
  }

  async cacheTenant(tenantId, tenantData, expiration = 3600) {
    return await this.set(`tenant:${tenantId}`, tenantData, expiration);
  }

  async getCachedTenant(tenantId) {
    return await this.get(`tenant:${tenantId}`);
  }

  async invalidateTenantCache(tenantId) {
    return await this.del(`tenant:${tenantId}`);
  }

  // Session management
  async setSession(sessionId, sessionData, expiration = 86400) {
    return await this.set(`session:${sessionId}`, sessionData, expiration);
  }

  async getSession(sessionId) {
    return await this.get(`session:${sessionId}`);
  }

  async deleteSession(sessionId) {
    return await this.del(`session:${sessionId}`);
  }

  // Rate limiting
  async incrementRateLimit(identifier, windowSeconds = 900) {
    const key = `rate_limit:${identifier}`;
    const current = await this.incr(key);
    
    if (current === 1) {
      await this.expire(key, windowSeconds);
    }
    
    return current;
  }

  async getRateLimit(identifier) {
    const key = `rate_limit:${identifier}`;
    return await this.get(key) || 0;
  }
}

module.exports = new RedisClient();