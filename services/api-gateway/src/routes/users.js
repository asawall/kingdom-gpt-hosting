const express = require('express');
const { body, validationResult } = require('express-validator');

const database = require('../utils/database');
const { asyncHandler, ValidationError, NotFoundError, ForbiddenError } = require('../middleware/errorHandler');
const { requireRole, requirePermission } = require('../middleware/auth');
const { checkSubscriptionLimits } = require('../middleware/tenant');
const { auditCriticalAction } = require('../middleware/audit');

const router = express.Router();

// Get all users in tenant
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, role } = req.query;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE u.tenant_id = $1';
  let params = [req.tenantId];
  let paramCount = 1;

  if (search) {
    whereClause += ` AND (u.email ILIKE $${++paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
    params.push(`%${search}%`);
  }

  if (role) {
    whereClause += ` AND u.role = $${++paramCount}`;
    params.push(role);
  }

  // Get total count
  const countResult = await database.query(
    `SELECT COUNT(*) as total FROM users u ${whereClause}`,
    params
  );

  // Get users with team information
  const result = await database.query(`
    SELECT 
      u.id, u.email, u.first_name, u.last_name, u.role, u.permissions, 
      u.email_verified, u.last_login, u.created_at,
      COUNT(tm.team_id) as team_count
    FROM users u
    LEFT JOIN team_members tm ON u.id = tm.user_id
    ${whereClause}
    GROUP BY u.id, u.email, u.first_name, u.last_name, u.role, u.permissions, u.email_verified, u.last_login, u.created_at
    ORDER BY u.created_at DESC
    LIMIT $${++paramCount} OFFSET $${++paramCount}
  `, [...params, limit, offset]);

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

// Get user by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await database.query(`
    SELECT 
      u.id, u.email, u.first_name, u.last_name, u.role, u.permissions, 
      u.settings, u.email_verified, u.last_login, u.created_at,
      ARRAY_AGG(
        CASE WHEN t.id IS NOT NULL THEN
          JSON_BUILD_OBJECT(
            'id', t.id,
            'name', t.name,
            'role', tm.role
          )
        END
      ) FILTER (WHERE t.id IS NOT NULL) as teams
    FROM users u
    LEFT JOIN team_members tm ON u.id = tm.user_id
    LEFT JOIN teams t ON tm.team_id = t.id
    WHERE u.id = $1 AND u.tenant_id = $2
    GROUP BY u.id, u.email, u.first_name, u.last_name, u.role, u.permissions, u.settings, u.email_verified, u.last_login, u.created_at
  `, [id, req.tenantId]);

  if (result.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  const user = result.rows[0];
  user.teams = user.teams || [];

  res.json({
    data: user
  });
}));

// Create new user
router.post('/', [
  requireRole(['admin', 'manager']),
  checkSubscriptionLimits('team_members'),
  body('email').isEmail().normalizeEmail(),
  body('firstName').trim().isLength({ min: 1, max: 50 }),
  body('lastName').trim().isLength({ min: 1, max: 50 }),
  body('role').isIn(['user', 'manager', 'admin']),
  body('permissions').optional().isArray()
], auditCriticalAction('Create User'), asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { email, firstName, lastName, role, permissions = [] } = req.body;

  // Check if user already exists
  const existingUser = await database.query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existingUser.rows.length > 0) {
    throw new ValidationError('User with this email already exists');
  }

  // Generate temporary password
  const tempPassword = require('crypto').randomBytes(12).toString('hex');
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  // Generate email verification token
  const emailVerificationToken = require('crypto').randomBytes(32).toString('hex');

  const result = await database.query(`
    INSERT INTO users 
    (tenant_id, email, password_hash, first_name, last_name, role, permissions, email_verification_token)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, email, first_name, last_name, role, permissions, created_at
  `, [req.tenantId, email, passwordHash, firstName, lastName, role, JSON.stringify(permissions), emailVerificationToken]);

  const user = result.rows[0];

  // TODO: Send welcome email with temporary password and verification link

  res.status(201).json({
    message: 'User created successfully',
    data: user,
    temporaryPassword: tempPassword // In production, this should be sent via email only
  });
}));

// Update user
router.put('/:id', [
  body('firstName').optional().trim().isLength({ min: 1, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 1, max: 50 }),
  body('role').optional().isIn(['user', 'manager', 'admin']),
  body('permissions').optional().isArray(),
  body('settings').optional().isObject()
], auditCriticalAction('Update User'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, role, permissions, settings } = req.body;

  // Check if user exists and belongs to tenant
  const existingUser = await database.query(
    'SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId]
  );

  if (existingUser.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  // Permission check: only admins can change roles, and no one can change admin role except themselves
  if (role && req.user.role !== 'admin') {
    throw new ForbiddenError('Insufficient permissions to change user role');
  }

  if (role === 'admin' && req.user.id !== id) {
    throw new ForbiddenError('Cannot modify admin role of other users');
  }

  // Build update query dynamically
  const updateFields = [];
  const updateValues = [];
  let paramCount = 0;

  if (firstName !== undefined) {
    updateFields.push(`first_name = $${++paramCount}`);
    updateValues.push(firstName);
  }

  if (lastName !== undefined) {
    updateFields.push(`last_name = $${++paramCount}`);
    updateValues.push(lastName);
  }

  if (role !== undefined) {
    updateFields.push(`role = $${++paramCount}`);
    updateValues.push(role);
  }

  if (permissions !== undefined) {
    updateFields.push(`permissions = $${++paramCount}`);
    updateValues.push(JSON.stringify(permissions));
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
    UPDATE users 
    SET ${updateFields.join(', ')}
    WHERE id = $${++paramCount} AND tenant_id = $${++paramCount}
    RETURNING id, email, first_name, last_name, role, permissions, settings, updated_at
  `, [...updateValues, id, req.tenantId]);

  // Invalidate cached user data
  const redis = require('../utils/redis');
  await redis.invalidateUserCache(id);

  res.json({
    message: 'User updated successfully',
    data: result.rows[0]
  });
}));

// Delete user
router.delete('/:id', [
  requireRole(['admin']),
  auditCriticalAction('Delete User')
], asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Prevent self-deletion
  if (req.user.id === id) {
    throw new ForbiddenError('Cannot delete your own account');
  }

  // Check if user exists and belongs to tenant
  const existingUser = await database.query(
    'SELECT id FROM users WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId]
  );

  if (existingUser.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  await database.query(
    'DELETE FROM users WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId]
  );

  // Invalidate cached user data
  const redis = require('../utils/redis');
  await redis.invalidateUserCache(id);

  res.json({
    message: 'User deleted successfully'
  });
}));

// Change password
router.post('/:id/change-password', [
  body('currentPassword').isLength({ min: 1 }),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
], asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body;

  // Users can only change their own password, unless admin
  if (req.user.id !== id && req.user.role !== 'admin') {
    throw new ForbiddenError('Can only change your own password');
  }

  const result = await database.query(
    'SELECT password_hash FROM users WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User not found');
  }

  // Verify current password (skip for admin changing other's password)
  if (req.user.id === id) {
    const bcrypt = require('bcryptjs');
    const isValidPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    
    if (!isValidPassword) {
      throw new ValidationError('Current password is incorrect');
    }
  }

  // Hash new password
  const bcrypt = require('bcryptjs');
  const newPasswordHash = await bcrypt.hash(newPassword, 12);

  await database.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
    [newPasswordHash, id, req.tenantId]
  );

  // Invalidate cached user data
  const redis = require('../utils/redis');
  await redis.invalidateUserCache(id);

  res.json({
    message: 'Password changed successfully'
  });
}));

// Get user activity/usage statistics
router.get('/:id/stats', asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Users can only view their own stats, unless admin/manager
  if (req.user.id !== id && !['admin', 'manager'].includes(req.user.role)) {
    throw new ForbiddenError('Can only view your own statistics');
  }

  const [aiJobsResult, filesResult, teamsResult] = await Promise.all([
    // AI jobs statistics
    database.query(`
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
        COALESCE(SUM(tokens_used), 0) as total_tokens,
        COALESCE(SUM(cost), 0) as total_cost
      FROM ai_jobs 
      WHERE user_id = $1 AND tenant_id = $2
    `, [id, req.tenantId]),

    // Files statistics
    database.query(`
      SELECT 
        COUNT(*) as total_files,
        COALESCE(SUM(size), 0) as total_size
      FROM files 
      WHERE user_id = $1 AND tenant_id = $2
    `, [id, req.tenantId]),

    // Teams membership
    database.query(`
      SELECT COUNT(*) as team_count
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.user_id = $1 AND t.tenant_id = $2
    `, [id, req.tenantId])
  ]);

  const stats = {
    ai: aiJobsResult.rows[0],
    files: filesResult.rows[0],
    teams: teamsResult.rows[0]
  };

  // Convert numeric strings to numbers
  stats.ai.total_jobs = parseInt(stats.ai.total_jobs);
  stats.ai.completed_jobs = parseInt(stats.ai.completed_jobs);
  stats.ai.failed_jobs = parseInt(stats.ai.failed_jobs);
  stats.ai.total_tokens = parseInt(stats.ai.total_tokens);
  stats.ai.total_cost = parseFloat(stats.ai.total_cost);

  stats.files.total_files = parseInt(stats.files.total_files);
  stats.files.total_size = parseInt(stats.files.total_size);

  stats.teams.team_count = parseInt(stats.teams.team_count);

  res.json({
    data: stats
  });
}));

module.exports = router;