const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Database health check
router.get('/db', async (req, res) => {
  try {
    const database = require('../utils/database');
    await database.query('SELECT 1');
    
    res.json({
      status: 'healthy',
      service: 'database',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'database',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Redis health check
router.get('/redis', async (req, res) => {
  try {
    const redis = require('../utils/redis');
    await redis.set('health_check', 'ok', 10);
    const result = await redis.get('health_check');
    
    if (result === 'ok') {
      res.json({
        status: 'healthy',
        service: 'redis',
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Redis health check failed');
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'redis',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Full health check
router.get('/full', async (req, res) => {
  const checks = [];
  let overallStatus = 'healthy';

  // Check database
  try {
    const database = require('../utils/database');
    await database.query('SELECT 1');
    checks.push({
      service: 'database',
      status: 'healthy'
    });
  } catch (error) {
    checks.push({
      service: 'database',
      status: 'unhealthy',
      error: error.message
    });
    overallStatus = 'unhealthy';
  }

  // Check Redis
  try {
    const redis = require('../utils/redis');
    await redis.set('health_check', 'ok', 10);
    const result = await redis.get('health_check');
    
    if (result === 'ok') {
      checks.push({
        service: 'redis',
        status: 'healthy'
      });
    } else {
      throw new Error('Redis health check failed');
    }
  } catch (error) {
    checks.push({
      service: 'redis',
      status: 'unhealthy',
      error: error.message
    });
    overallStatus = 'unhealthy';
  }

  const statusCode = overallStatus === 'healthy' ? 200 : 503;

  res.status(statusCode).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    checks
  });
});

module.exports = router;