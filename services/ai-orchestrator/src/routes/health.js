const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/', (req, res) => {
  const orchestrator = req.app.locals.orchestrator;
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    initialized: orchestrator ? orchestrator.isInitialized() : false
  });
});

// Hardware status
router.get('/hardware', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator;
    
    if (!orchestrator || !orchestrator.isInitialized()) {
      return res.status(503).json({
        status: 'unavailable',
        message: 'Orchestrator not initialized'
      });
    }

    const hardwareDetector = orchestrator.getHardwareDetector();
    const hardwareInfo = hardwareDetector.getHardwareInfo();
    const optimalConfig = hardwareDetector.getOptimalModelConfiguration();
    
    res.json({
      status: 'healthy',
      hardware: hardwareInfo,
      optimal_configuration: optimalConfig,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Model availability check
router.get('/models', async (req, res) => {
  try {
    const database = require('../utils/database');
    const redis = require('../utils/redis');
    
    // Get models from database
    const result = await database.query(
      'SELECT * FROM ai_models WHERE is_active = true ORDER BY name'
    );
    
    // Get availability status from Redis
    const models = [];
    for (const model of result.rows) {
      const isAvailable = await redis.hGet('model_availability', model.name);
      models.push({
        ...model,
        available: isAvailable !== null ? isAvailable : true
      });
    }
    
    res.json({
      status: 'healthy',
      models: models,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;