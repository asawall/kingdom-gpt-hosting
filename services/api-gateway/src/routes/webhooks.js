const express = require('express');
const { body, validationResult } = require('express-validator');

const database = require('../utils/database');
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { requireRole } = require('../middleware/auth');
const { auditCriticalAction } = require('../middleware/audit');

const router = express.Router();

// Get all webhooks for tenant
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const result = await database.query(`
    SELECT id, name, url, events, is_active, retry_count, last_triggered, created_at
    FROM webhooks 
    WHERE tenant_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `, [req.tenantId, limit, offset]);

  const countResult = await database.query(
    'SELECT COUNT(*) as total FROM webhooks WHERE tenant_id = $1',
    [req.tenantId]
  );

  const total = parseInt(countResult.rows[0].total);
  const totalPages = Math.ceil(total / limit);

  res.json({
    data: result.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  });
}));

// Create webhook
router.post('/', [
  requireRole(['admin', 'manager']),
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('url').isURL(),
  body('events').isArray().custom((events) => {
    const validEvents = [
      'user.created', 'user.updated', 'user.deleted',
      'ai.job.completed', 'ai.job.failed',
      'payment.succeeded', 'payment.failed',
      'file.uploaded', 'file.deleted'
    ];
    return events.every(event => validEvents.includes(event));
  })
], auditCriticalAction('Create Webhook'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { name, url, events } = req.body;

  // Generate webhook secret
  const crypto = require('crypto');
  const secret = crypto.randomBytes(32).toString('hex');

  const result = await database.query(`
    INSERT INTO webhooks (tenant_id, name, url, events, secret)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, url, events, secret, is_active, created_at
  `, [req.tenantId, name, url, events, secret]);

  res.status(201).json({
    message: 'Webhook created successfully',
    data: result.rows[0]
  });
}));

// Update webhook
router.put('/:id', [
  requireRole(['admin', 'manager']),
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('url').optional().isURL(),
  body('events').optional().isArray(),
  body('is_active').optional().isBoolean()
], auditCriticalAction('Update Webhook'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, url, events, is_active } = req.body;

  // Check if webhook exists
  const existingWebhook = await database.query(
    'SELECT id FROM webhooks WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId]
  );

  if (existingWebhook.rows.length === 0) {
    throw new NotFoundError('Webhook not found');
  }

  // Build update query
  const updateFields = [];
  const updateValues = [];
  let paramCount = 0;

  if (name !== undefined) {
    updateFields.push(`name = $${++paramCount}`);
    updateValues.push(name);
  }

  if (url !== undefined) {
    updateFields.push(`url = $${++paramCount}`);
    updateValues.push(url);
  }

  if (events !== undefined) {
    updateFields.push(`events = $${++paramCount}`);
    updateValues.push(events);
  }

  if (is_active !== undefined) {
    updateFields.push(`is_active = $${++paramCount}`);
    updateValues.push(is_active);
  }

  updateFields.push(`updated_at = NOW()`);

  const result = await database.query(`
    UPDATE webhooks 
    SET ${updateFields.join(', ')}
    WHERE id = $${++paramCount} AND tenant_id = $${++paramCount}
    RETURNING id, name, url, events, is_active, updated_at
  `, [...updateValues, id, req.tenantId]);

  res.json({
    message: 'Webhook updated successfully',
    data: result.rows[0]
  });
}));

// Delete webhook
router.delete('/:id', [
  requireRole(['admin']),
  auditCriticalAction('Delete Webhook')
], asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await database.query(
    'DELETE FROM webhooks WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('Webhook not found');
  }

  res.json({
    message: 'Webhook deleted successfully'
  });
}));

// Test webhook
router.post('/:id/test', [
  requireRole(['admin', 'manager'])
], asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await database.query(
    'SELECT * FROM webhooks WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Webhook not found');
  }

  const webhook = result.rows[0];

  // Send test payload
  const testPayload = {
    event: 'webhook.test',
    timestamp: new Date().toISOString(),
    data: {
      message: 'This is a test webhook from Kingdom SaaS'
    }
  };

  try {
    const axios = require('axios');
    const crypto = require('crypto');

    // Create signature
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(JSON.stringify(testPayload))
      .digest('hex');

    const response = await axios.post(webhook.url, testPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'User-Agent': 'Kingdom-SaaS-Webhook/1.0'
      },
      timeout: 10000
    });

    res.json({
      message: 'Webhook test successful',
      status: response.status,
      response: response.data
    });

  } catch (error) {
    res.status(400).json({
      message: 'Webhook test failed',
      error: error.message
    });
  }
}));

module.exports = router;