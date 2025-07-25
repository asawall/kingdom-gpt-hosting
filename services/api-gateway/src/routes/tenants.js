const express = require('express');
const { body, validationResult } = require('express-validator');

const database = require('../utils/database');
const { asyncHandler, ValidationError, NotFoundError, ForbiddenError } = require('../middleware/errorHandler');
const { requireRole } = require('../middleware/auth');
const { auditCriticalAction } = require('../middleware/audit');

const router = express.Router();

// Get current tenant information
router.get('/current', asyncHandler(async (req, res) => {
  const result = await database.query(
    'SELECT id, name, domain, settings, subscription_plan, subscription_status, created_at FROM tenants WHERE id = $1',
    [req.tenantId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Tenant not found');
  }

  const tenant = result.rows[0];

  res.json({
    data: tenant
  });
}));

// Update tenant settings
router.put('/current', [
  requireRole(['admin']),
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('domain').optional().matches(/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/),
  body('settings').optional().isObject()
], auditCriticalAction('Update Tenant Settings'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { name, domain, settings } = req.body;

  // Check if domain is already taken by another tenant
  if (domain) {
    const existingDomain = await database.query(
      'SELECT id FROM tenants WHERE domain = $1 AND id != $2',
      [domain, req.tenantId]
    );

    if (existingDomain.rows.length > 0) {
      throw new ValidationError('Domain is already taken by another tenant');
    }
  }

  // Build update query dynamically
  const updateFields = [];
  const updateValues = [];
  let paramCount = 0;

  if (name !== undefined) {
    updateFields.push(`name = $${++paramCount}`);
    updateValues.push(name);
  }

  if (domain !== undefined) {
    updateFields.push(`domain = $${++paramCount}`);
    updateValues.push(domain);
  }

  if (settings !== undefined) {
    updateFields.push(`settings = $${++paramCount}`);
    updateValues.push(JSON.stringify(settings));
  }

  updateFields.push(`updated_at = NOW()`);

  if (updateFields.length === 1) { // Only updated_at
    throw new ValidationError('No fields to update');
  }

  const result = await database.query(`
    UPDATE tenants 
    SET ${updateFields.join(', ')}
    WHERE id = $${++paramCount}
    RETURNING id, name, domain, settings, subscription_plan, subscription_status, updated_at
  `, [...updateValues, req.tenantId]);

  // Invalidate cached tenant data
  const redis = require('../utils/redis');
  await redis.invalidateTenantCache(req.tenantId);

  res.json({
    message: 'Tenant updated successfully',
    data: result.rows[0]
  });
}));

// Get tenant statistics
router.get('/stats', [
  requireRole(['admin', 'manager'])
], asyncHandler(async (req, res) => {
  const [usersResult, teamsResult, aiJobsResult, filesResult] = await Promise.all([
    // Users statistics
    database.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN email_verified = true THEN 1 END) as verified_users,
        COUNT(CASE WHEN last_login > NOW() - INTERVAL '30 days' THEN 1 END) as active_users,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
        COUNT(CASE WHEN role = 'manager' THEN 1 END) as manager_users,
        COUNT(CASE WHEN role = 'user' THEN 1 END) as regular_users
      FROM users 
      WHERE tenant_id = $1
    `, [req.tenantId]),

    // Teams statistics
    database.query(`
      SELECT 
        COUNT(*) as total_teams,
        AVG((
          SELECT COUNT(*) 
          FROM team_members tm 
          WHERE tm.team_id = t.id
        )) as avg_team_size
      FROM teams t
      WHERE tenant_id = $1
    `, [req.tenantId]),

    // AI jobs statistics
    database.query(`
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_jobs,
        COALESCE(SUM(tokens_used), 0) as total_tokens,
        COALESCE(SUM(cost), 0) as total_cost,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as jobs_last_30_days
      FROM ai_jobs 
      WHERE tenant_id = $1
    `, [req.tenantId]),

    // Files statistics
    database.query(`
      SELECT 
        COUNT(*) as total_files,
        COALESCE(SUM(size), 0) as total_size,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as files_last_30_days
      FROM files 
      WHERE tenant_id = $1
    `, [req.tenantId])
  ]);

  const stats = {
    users: usersResult.rows[0],
    teams: teamsResult.rows[0],
    ai: aiJobsResult.rows[0],
    files: filesResult.rows[0]
  };

  // Convert numeric strings to numbers
  Object.keys(stats).forEach(category => {
    Object.keys(stats[category]).forEach(key => {
      const value = stats[category][key];
      if (typeof value === 'string' && !isNaN(value)) {
        if (key.includes('cost') || key.includes('avg')) {
          stats[category][key] = parseFloat(value);
        } else {
          stats[category][key] = parseInt(value);
        }
      }
    });
  });

  res.json({
    data: stats
  });
}));

// Get subscription usage
router.get('/usage', asyncHandler(async (req, res) => {
  const tenant = req.tenant;
  const subscriptionPlan = tenant.subscription_plan;

  // Define subscription limits
  const limits = {
    free: {
      ai_requests_per_month: 100,
      storage_gb: 1,
      team_members: 3,
      webhooks: 1
    },
    basic: {
      ai_requests_per_month: 1000,
      storage_gb: 10,
      team_members: 10,
      webhooks: 5
    },
    pro: {
      ai_requests_per_month: 10000,
      storage_gb: 100,
      team_members: 50,
      webhooks: 25
    },
    enterprise: {
      ai_requests_per_month: -1, // unlimited
      storage_gb: -1, // unlimited
      team_members: -1, // unlimited
      webhooks: -1 // unlimited
    }
  };

  const planLimits = limits[subscriptionPlan] || limits.free;

  // Get current usage
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [aiUsageResult, storageResult, membersResult, webhooksResult] = await Promise.all([
    // AI requests this month
    database.query(
      'SELECT COUNT(*) as count FROM ai_jobs WHERE tenant_id = $1 AND created_at >= $2',
      [req.tenantId, startOfMonth]
    ),

    // Storage usage
    database.query(
      'SELECT COALESCE(SUM(size), 0) as total_size FROM files WHERE tenant_id = $1',
      [req.tenantId]
    ),

    // Team members
    database.query(
      'SELECT COUNT(DISTINCT user_id) as count FROM team_members tm JOIN teams t ON tm.team_id = t.id WHERE t.tenant_id = $1',
      [req.tenantId]
    ),

    // Active webhooks
    database.query(
      'SELECT COUNT(*) as count FROM webhooks WHERE tenant_id = $1 AND is_active = true',
      [req.tenantId]
    )
  ]);

  const usage = {
    ai_requests_per_month: {
      current: parseInt(aiUsageResult.rows[0].count),
      limit: planLimits.ai_requests_per_month,
      unlimited: planLimits.ai_requests_per_month === -1
    },
    storage_gb: {
      current: Math.ceil(parseInt(storageResult.rows[0].total_size) / (1024 * 1024 * 1024)),
      limit: planLimits.storage_gb,
      unlimited: planLimits.storage_gb === -1
    },
    team_members: {
      current: parseInt(membersResult.rows[0].count),
      limit: planLimits.team_members,
      unlimited: planLimits.team_members === -1
    },
    webhooks: {
      current: parseInt(webhooksResult.rows[0].count),
      limit: planLimits.webhooks,
      unlimited: planLimits.webhooks === -1
    }
  };

  // Calculate usage percentages
  Object.keys(usage).forEach(key => {
    const item = usage[key];
    if (!item.unlimited && item.limit > 0) {
      item.percentage = Math.round((item.current / item.limit) * 100);
      item.remaining = Math.max(0, item.limit - item.current);
    } else if (item.unlimited) {
      item.percentage = 0;
      item.remaining = -1;
    }
  });

  res.json({
    data: {
      subscription_plan: subscriptionPlan,
      usage,
      limits: planLimits
    }
  });
}));

// Get all teams in tenant
router.get('/teams', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE t.tenant_id = $1';
  let params = [req.tenantId];
  let paramCount = 1;

  if (search) {
    whereClause += ` AND (t.name ILIKE $${++paramCount} OR t.description ILIKE $${paramCount})`;
    params.push(`%${search}%`);
  }

  // Get total count
  const countResult = await database.query(
    `SELECT COUNT(*) as total FROM teams t ${whereClause}`,
    params
  );

  // Get teams with member count and creator information
  const result = await database.query(`
    SELECT 
      t.id, t.name, t.description, t.created_at,
      u.first_name as creator_first_name, u.last_name as creator_last_name,
      COUNT(tm.user_id) as member_count
    FROM teams t
    LEFT JOIN users u ON t.created_by = u.id
    LEFT JOIN team_members tm ON t.id = tm.team_id
    ${whereClause}
    GROUP BY t.id, t.name, t.description, t.created_at, u.first_name, u.last_name
    ORDER BY t.created_at DESC
    LIMIT $${++paramCount} OFFSET $${++paramCount}
  `, [...params, limit, offset]);

  const total = parseInt(countResult.rows[0].total);
  const totalPages = Math.ceil(total / limit);

  res.json({
    data: result.rows.map(team => ({
      ...team,
      member_count: parseInt(team.member_count)
    })),
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

// Create new team
router.post('/teams', [
  requireRole(['admin', 'manager']),
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('description').optional().trim().isLength({ max: 500 })
], auditCriticalAction('Create Team'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { name, description } = req.body;

  // Check if team name already exists in tenant
  const existingTeam = await database.query(
    'SELECT id FROM teams WHERE name = $1 AND tenant_id = $2',
    [name, req.tenantId]
  );

  if (existingTeam.rows.length > 0) {
    throw new ValidationError('Team with this name already exists');
  }

  const result = await database.query(`
    INSERT INTO teams (tenant_id, name, description, created_by)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, description, created_at
  `, [req.tenantId, name, description, req.userId]);

  res.status(201).json({
    message: 'Team created successfully',
    data: result.rows[0]
  });
}));

module.exports = router;