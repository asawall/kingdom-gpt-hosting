const express = require('express');
const { body, validationResult } = require('express-validator');
const { createProxyMiddleware } = require('http-proxy-middleware');

const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { checkSubscriptionLimits } = require('../middleware/tenant');

const router = express.Router();

// Proxy to AI Orchestrator service
const aiProxy = createProxyMiddleware({
  target: 'http://ai-orchestrator:3000',
  changeOrigin: true,
  pathRewrite: { '^/api/ai': '/api/ai' },
  onProxyReq: (proxyReq, req, res) => {
    // Add tenant and user headers for the AI service
    if (req.tenantId) {
      proxyReq.setHeader('x-tenant-id', req.tenantId);
    }
    if (req.userId) {
      proxyReq.setHeader('x-user-id', req.userId);
    }
  },
  onError: (err, req, res) => {
    logger.error('AI Orchestrator proxy error:', err);
    res.status(503).json({
      error: 'AI service unavailable',
      message: 'Unable to connect to AI processing service'
    });
  }
});

// Process AI request with subscription limits
router.post('/process', [
  checkSubscriptionLimits('ai_requests_per_month'),
  body('prompt').isLength({ min: 1, max: 10000 }),
  body('model').optional().isString(),
  body('options').optional().isObject()
], asyncHandler(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }
  
  // Use proxy to forward to AI Orchestrator
  aiProxy(req, res, next);
}));

// Stream AI response with subscription limits
router.post('/stream', [
  checkSubscriptionLimits('ai_requests_per_month'),
  body('prompt').isLength({ min: 1, max: 10000 }),
  body('model').optional().isString(),
  body('options').optional().isObject()
], asyncHandler(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }
  
  // Use proxy to forward to AI Orchestrator
  aiProxy(req, res, next);
}));

// Get job status
router.get('/jobs/:jobId', aiProxy);

// Get job history
router.get('/jobs', aiProxy);

// Get available models
router.get('/models', aiProxy);

// Get hardware status (admin only)
router.get('/hardware', [
  requireRole(['admin'])
], aiProxy);

module.exports = router;