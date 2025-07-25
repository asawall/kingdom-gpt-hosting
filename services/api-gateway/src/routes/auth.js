const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

const database = require('../utils/database');
const redis = require('../utils/redis');
const logger = require('../utils/logger');
const { asyncHandler, ValidationError, UnauthorizedError, ConflictError } = require('../middleware/errorHandler');

const router = express.Router();

// Register new user and tenant
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/),
  body('firstName').trim().isLength({ min: 1, max: 50 }),
  body('lastName').trim().isLength({ min: 1, max: 50 }),
  body('companyName').trim().isLength({ min: 1, max: 100 }),
  body('domain').optional().matches(/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { email, password, firstName, lastName, companyName, domain } = req.body;

  const client = await database.getClient();
  
  try {
    await client.query('BEGIN');

    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new ConflictError('User with this email already exists');
    }

    // Check if domain is already taken
    if (domain) {
      const existingDomain = await client.query(
        'SELECT id FROM tenants WHERE domain = $1',
        [domain]
      );

      if (existingDomain.rows.length > 0) {
        throw new ConflictError('Domain is already taken');
      }
    }

    // Create tenant
    const tenantResult = await client.query(`
      INSERT INTO tenants (name, domain, subscription_plan, subscription_status)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [companyName, domain, 'free', 'active']);

    const tenantId = tenantResult.rows[0].id;

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    // Create user
    const userResult = await client.query(`
      INSERT INTO users 
      (tenant_id, email, password_hash, first_name, last_name, role, email_verification_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, email, first_name, last_name, role, created_at
    `, [tenantId, email, passwordHash, firstName, lastName, 'admin', emailVerificationToken]);

    const user = userResult.rows[0];

    // Create default team
    await client.query(`
      INSERT INTO teams (tenant_id, name, description, created_by)
      VALUES ($1, $2, $3, $4)
    `, [tenantId, 'Default Team', 'Default team for the organization', user.id]);

    await client.query('COMMIT');

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        tenantId: tenantId,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Cache user data
    await redis.cacheUser(user.id, { ...user, tenant_id: tenantId }, 3600);

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      message: 'Registration successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          createdAt: user.created_at
        },
        tenant: {
          id: tenantId,
          name: companyName,
          domain: domain
        },
        token,
        emailVerificationRequired: true
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 1 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }

  const { email, password } = req.body;

  // Get user with tenant information
  const result = await database.query(`
    SELECT 
      u.id, u.tenant_id, u.email, u.password_hash, u.first_name, u.last_name, 
      u.role, u.permissions, u.email_verified, u.settings,
      t.name as tenant_name, t.domain as tenant_domain, t.subscription_plan, t.subscription_status
    FROM users u
    JOIN tenants t ON u.tenant_id = t.id
    WHERE u.email = $1
  `, [email]);

  if (result.rows.length === 0) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const user = result.rows[0];

  // Check password
  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Check if tenant subscription is active
  if (user.subscription_status !== 'active') {
    throw new UnauthorizedError('Account suspended. Please contact support.');
  }

  // Generate JWT token
  const token = jwt.sign(
    { 
      userId: user.id, 
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Update last login
  await database.query(
    'UPDATE users SET last_login = NOW() WHERE id = $1',
    [user.id]
  );

  // Cache user data
  await redis.cacheUser(user.id, user, 3600);

  logger.info(`User logged in: ${email}`);

  res.json({
    message: 'Login successful',
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        permissions: user.permissions,
        emailVerified: user.email_verified,
        settings: user.settings
      },
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        domain: user.tenant_domain,
        subscriptionPlan: user.subscription_plan
      },
      token
    }
  });
}));

// Verify email
router.post('/verify-email', [
  body('token').isLength({ min: 1 })
], asyncHandler(async (req, res) => {
  const { token } = req.body;

  const result = await database.query(
    'SELECT id, email FROM users WHERE email_verification_token = $1',
    [token]
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('Invalid verification token');
  }

  const user = result.rows[0];

  // Update user as verified
  await database.query(
    'UPDATE users SET email_verified = true, email_verification_token = NULL WHERE id = $1',
    [user.id]
  );

  // Invalidate cached user data
  await redis.invalidateUserCache(user.id);

  logger.info(`Email verified for user: ${user.email}`);

  res.json({
    message: 'Email verified successfully'
  });
}));

// Forgot password
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], asyncHandler(async (req, res) => {
  const { email } = req.body;

  const result = await database.query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    // Don't reveal if email exists or not
    return res.json({
      message: 'If the email exists, a password reset link has been sent'
    });
  }

  const user = result.rows[0];

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + 3600000); // 1 hour

  // Update user with reset token
  await database.query(
    'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
    [resetToken, resetExpires, user.id]
  );

  // In production, send email with reset link
  logger.info(`Password reset requested for: ${email}`);

  res.json({
    message: 'If the email exists, a password reset link has been sent'
  });
}));

// Reset password
router.post('/reset-password', [
  body('token').isLength({ min: 1 }),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
], asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const result = await database.query(
    'SELECT id, email FROM users WHERE password_reset_token = $1 AND password_reset_expires > NOW()',
    [token]
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }

  const user = result.rows[0];

  // Hash new password
  const passwordHash = await bcrypt.hash(password, 12);

  // Update password and clear reset token
  await database.query(
    'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2',
    [passwordHash, user.id]
  );

  // Invalidate cached user data
  await redis.invalidateUserCache(user.id);

  logger.info(`Password reset completed for: ${user.email}`);

  res.json({
    message: 'Password reset successful'
  });
}));

// Logout (blacklist token)
router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
      
      if (expiresIn > 0) {
        // Add token to blacklist
        await redis.set(`blacklist:${token}`, true, expiresIn);
      }
      
      // Invalidate cached user data
      await redis.invalidateUserCache(decoded.userId);
      
      logger.info(`User logged out: ${decoded.email}`);
    } catch (error) {
      // Token already invalid, ignore
    }
  }

  res.json({
    message: 'Logout successful'
  });
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    throw new UnauthorizedError('No token provided');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token is blacklisted
    const isBlacklisted = await redis.exists(`blacklist:${token}`);
    if (isBlacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    // Generate new token
    const newToken = jwt.sign(
      { 
        userId: decoded.userId, 
        tenantId: decoded.tenantId,
        email: decoded.email,
        role: decoded.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Token refreshed successfully',
      data: {
        token: newToken
      }
    });

  } catch (error) {
    throw new UnauthorizedError('Invalid token');
  }
}));

module.exports = router;