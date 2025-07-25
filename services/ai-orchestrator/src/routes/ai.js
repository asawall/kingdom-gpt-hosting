const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger');
const database = require('../utils/database');
const redis = require('../utils/redis');

const router = express.Router();

// Process AI request
router.post('/process', [
  body('prompt').isLength({ min: 1, max: 10000 }),
  body('model').optional().isString(),
  body('options').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { prompt, model: requestedModel, options = {} } = req.body;
    const orchestrator = req.app.locals.orchestrator;

    if (!orchestrator.isInitialized()) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'AI Orchestrator is not ready'
      });
    }

    // Create AI job record
    const jobId = uuidv4();
    await database.query(`
      INSERT INTO ai_jobs (id, tenant_id, user_id, prompt, status, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      jobId,
      req.headers['x-tenant-id'] || null,
      req.headers['x-user-id'] || null,
      prompt,
      'pending',
      JSON.stringify({ requestedModel, options })
    ]);

    // Select best model if not specified
    let selectedModel = requestedModel;
    if (!selectedModel) {
      const availableModels = await redis.get('assigned_models') || ['gpt-3.5-turbo'];
      selectedModel = availableModels[0];
    }

    // Get model information
    const modelResult = await database.query(
      'SELECT * FROM ai_models WHERE name = $1 AND is_active = true',
      [selectedModel]
    );

    if (modelResult.rows.length === 0) {
      await database.query(
        'UPDATE ai_jobs SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', `Model ${selectedModel} not found or inactive`, jobId]
      );

      return res.status(400).json({
        error: 'Model not available',
        message: `Model ${selectedModel} is not available`
      });
    }

    const modelInfo = modelResult.rows[0];
    const provider = orchestrator.getProvider(modelInfo.provider);

    if (!provider) {
      await database.query(
        'UPDATE ai_jobs SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', `Provider ${modelInfo.provider} not available`, jobId]
      );

      return res.status(503).json({
        error: 'Provider unavailable',
        message: `Provider ${modelInfo.provider} is not available`
      });
    }

    // Process the request
    try {
      await database.query(
        'UPDATE ai_jobs SET status = $1, model_id = $2 WHERE id = $3',
        ['processing', modelInfo.id, jobId]
      );

      const startTime = Date.now();
      const result = await provider.generateText(prompt, {
        model: selectedModel,
        ...options
      });
      const processingTime = Date.now() - startTime;

      // Update job with results
      await database.query(`
        UPDATE ai_jobs 
        SET status = $1, response = $2, tokens_used = $3, cost = $4, 
            processing_time = $5, completed_at = NOW()
        WHERE id = $6
      `, [
        'completed',
        result.response,
        result.usage.total_tokens,
        result.cost,
        processingTime,
        jobId
      ]);

      // Publish real-time update
      await redis.publish('ai_job_updates', {
        jobId,
        status: 'completed',
        result: result.response,
        usage: result.usage,
        processingTime
      });

      res.json({
        success: true,
        data: {
          jobId,
          response: result.response,
          model: selectedModel,
          provider: result.provider,
          usage: result.usage,
          cost: result.cost,
          processingTime
        }
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      await database.query(`
        UPDATE ai_jobs 
        SET status = $1, error_message = $2, processing_time = $3, completed_at = NOW()
        WHERE id = $4
      `, ['failed', error.message, processingTime, jobId]);

      // Publish error update
      await redis.publish('ai_job_updates', {
        jobId,
        status: 'failed',
        error: error.message
      });

      throw error;
    }

  } catch (error) {
    logger.error('AI processing error:', error);
    res.status(500).json({
      error: 'Processing failed',
      message: error.message
    });
  }
});

// Stream AI response
router.post('/stream', [
  body('prompt').isLength({ min: 1, max: 10000 }),
  body('model').optional().isString(),
  body('options').optional().isObject()
], async (req, res) => {
  try {
    const { prompt, model: requestedModel, options = {} } = req.body;
    const orchestrator = req.app.locals.orchestrator;

    if (!orchestrator.isInitialized()) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'AI Orchestrator is not ready'
      });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const jobId = uuidv4();
    
    // Select model
    let selectedModel = requestedModel;
    if (!selectedModel) {
      const availableModels = await redis.get('assigned_models') || ['gpt-3.5-turbo'];
      selectedModel = availableModels[0];
    }

    // Get model and provider
    const modelResult = await database.query(
      'SELECT * FROM ai_models WHERE name = $1 AND is_active = true',
      [selectedModel]
    );

    if (modelResult.rows.length === 0) {
      res.write(`data: ${JSON.stringify({ error: 'Model not available' })}\n\n`);
      res.end();
      return;
    }

    const modelInfo = modelResult.rows[0];
    const provider = orchestrator.getProvider(modelInfo.provider);

    if (!provider || !provider.generateTextStream) {
      res.write(`data: ${JSON.stringify({ error: 'Streaming not supported for this provider' })}\n\n`);
      res.end();
      return;
    }

    // Create job record
    await database.query(`
      INSERT INTO ai_jobs (id, tenant_id, user_id, prompt, status, model_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      jobId,
      req.headers['x-tenant-id'] || null,
      req.headers['x-user-id'] || null,
      prompt,
      'streaming',
      modelInfo.id,
      JSON.stringify({ requestedModel, options, streaming: true })
    ]);

    res.write(`data: ${JSON.stringify({ jobId, status: 'started' })}\n\n`);

    const startTime = Date.now();
    
    try {
      const result = await provider.generateTextStream(prompt, {
        model: selectedModel,
        ...options
      }, (chunk) => {
        // Send chunk to client
        res.write(`data: ${JSON.stringify({
          jobId,
          type: 'chunk',
          content: chunk.chunk,
          tokenCount: chunk.tokenCount
        })}\n\n`);
      });

      const processingTime = Date.now() - startTime;

      // Update job with final results
      await database.query(`
        UPDATE ai_jobs 
        SET status = $1, response = $2, tokens_used = $3, cost = $4, 
            processing_time = $5, completed_at = NOW()
        WHERE id = $6
      `, [
        'completed',
        result.response,
        result.usage.total_tokens,
        result.cost,
        processingTime,
        jobId
      ]);

      // Send final message
      res.write(`data: ${JSON.stringify({
        jobId,
        type: 'complete',
        usage: result.usage,
        cost: result.cost,
        processingTime
      })}\n\n`);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      await database.query(`
        UPDATE ai_jobs 
        SET status = $1, error_message = $2, processing_time = $3, completed_at = NOW()
        WHERE id = $4
      `, ['failed', error.message, processingTime, jobId]);

      res.write(`data: ${JSON.stringify({
        jobId,
        type: 'error',
        error: error.message
      })}\n\n`);
    }

    res.end();

  } catch (error) {
    logger.error('AI streaming error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`);
    res.end();
  }
});

// Get job status
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    const result = await database.query(
      'SELECT * FROM ai_jobs WHERE id = $1',
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Job not found'
      });
    }

    const job = result.rows[0];
    res.json({
      data: job
    });

  } catch (error) {
    logger.error('Get job error:', error);
    res.status(500).json({
      error: 'Failed to get job status'
    });
  }
});

// Get job history
router.get('/jobs', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];
    let paramCount = 0;

    if (req.headers['x-tenant-id']) {
      whereClause += `WHERE tenant_id = $${++paramCount}`;
      params.push(req.headers['x-tenant-id']);
    }

    if (status) {
      whereClause += whereClause ? ` AND status = $${++paramCount}` : `WHERE status = $${++paramCount}`;
      params.push(status);
    }

    const result = await database.query(`
      SELECT 
        aj.*, am.name as model_name, am.provider
      FROM ai_jobs aj
      LEFT JOIN ai_models am ON aj.model_id = am.id
      ${whereClause}
      ORDER BY aj.created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `, [...params, limit, offset]);

    res.json({
      data: result.rows
    });

  } catch (error) {
    logger.error('Get jobs error:', error);
    res.status(500).json({
      error: 'Failed to get job history'
    });
  }
});

module.exports = router;