const jwt = require('jsonwebtoken');
const database = require('../utils/database');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'No token provided'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token is blacklisted
    const isBlacklisted = await redis.exists(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Token has been revoked'
      });
    }

    // Try to get user from cache first
    let user = await redis.getCachedUser(decoded.userId);
    
    if (!user) {
      // Fetch user from database
      const result = await database.query(
        'SELECT id, tenant_id, email, first_name, last_name, role, permissions, settings FROM users WHERE id = $1 AND email_verified = true',
        [decoded.userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({
          error: 'Access denied',
          message: 'User not found or not verified'
        });
      }
      
      user = result.rows[0];
      
      // Cache user for 1 hour
      await redis.cacheUser(decoded.userId, user, 3600);
    }

    // Attach user info to request
    req.user = user;
    req.userId = user.id;
    req.tenantId = user.tenant_id;
    
    // Update last login
    await database.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Token expired'
      });
    }
    
    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication failed'
    });
  }
};

// Role-based access control middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Authentication required'
      });
    }
    
    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Insufficient permissions'
      });
    }
    
    next();
  };
};

// Permission-based access control middleware
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Authentication required'
      });
    }
    
    const userPermissions = req.user.permissions || [];
    
    if (!userPermissions.includes(permission) && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Insufficient permissions'
      });
    }
    
    next();
  };
};

// Optional authentication middleware
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Check if token is blacklisted
      const isBlacklisted = await redis.exists(`blacklist:${token}`);
      if (!isBlacklisted) {
        // Try to get user from cache
        let user = await redis.getCachedUser(decoded.userId);
        
        if (!user) {
          const result = await database.query(
            'SELECT id, tenant_id, email, first_name, last_name, role, permissions FROM users WHERE id = $1',
            [decoded.userId]
          );
          
          if (result.rows.length > 0) {
            user = result.rows[0];
            await redis.cacheUser(decoded.userId, user, 3600);
          }
        }
        
        if (user) {
          req.user = user;
          req.userId = user.id;
          req.tenantId = user.tenant_id;
        }
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

module.exports = {
  authMiddleware,
  requireRole,
  requirePermission,
  optionalAuth
};