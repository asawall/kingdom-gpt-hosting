const database = require('../utils/database');
const logger = require('../utils/logger');

const auditMiddleware = async (req, res, next) => {
  // Store original res.json to intercept responses
  const originalJson = res.json;
  
  res.json = function(data) {
    // Log the audit event after response
    setImmediate(async () => {
      try {
        await logAuditEvent(req, res, data);
      } catch (error) {
        logger.error('Audit logging failed:', error);
      }
    });
    
    // Call original json method
    return originalJson.call(this, data);
  };
  
  next();
};

const logAuditEvent = async (req, res, responseData) => {
  try {
    // Only log certain HTTP methods and successful responses
    const auditMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    
    if (!auditMethods.includes(req.method) || res.statusCode >= 400) {
      return;
    }
    
    // Extract relevant information
    const action = `${req.method} ${req.route?.path || req.path}`;
    const resourceType = extractResourceType(req.path);
    const resourceId = extractResourceId(req, responseData);
    const details = {
      method: req.method,
      path: req.path,
      query: req.query,
      body: sanitizeBody(req.body),
      statusCode: res.statusCode,
      userAgent: req.get('User-Agent'),
      responseTime: res.get('X-Response-Time')
    };
    
    // Get client IP
    const ipAddress = req.ip || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     (req.connection.socket ? req.connection.socket.remoteAddress : null);
    
    // Insert audit log
    await database.query(`
      INSERT INTO audit_logs 
      (tenant_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      req.tenantId || null,
      req.userId || null,
      action,
      resourceType,
      resourceId,
      JSON.stringify(details),
      ipAddress,
      req.get('User-Agent')
    ]);
    
  } catch (error) {
    logger.error('Failed to log audit event:', error);
  }
};

const extractResourceType = (path) => {
  // Extract resource type from API path
  const pathParts = path.split('/').filter(Boolean);
  
  if (pathParts.length >= 2 && pathParts[0] === 'api') {
    return pathParts[1];
  }
  
  return 'unknown';
};

const extractResourceId = (req, responseData) => {
  // Try to extract resource ID from various sources
  
  // From URL parameters
  if (req.params && req.params.id) {
    return req.params.id;
  }
  
  // From response data
  if (responseData && typeof responseData === 'object') {
    if (responseData.id) {
      return responseData.id;
    }
    
    if (responseData.data && responseData.data.id) {
      return responseData.data.id;
    }
  }
  
  // From request body
  if (req.body && req.body.id) {
    return req.body.id;
  }
  
  return null;
};

const sanitizeBody = (body) => {
  if (!body || typeof body !== 'object') {
    return body;
  }
  
  // Remove sensitive fields from audit log
  const sensitiveFields = [
    'password',
    'password_hash',
    'token',
    'secret',
    'api_key',
    'private_key',
    'credit_card',
    'ssn',
    'social_security_number'
  ];
  
  const sanitized = { ...body };
  
  const sanitizeObject = (obj) => {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();
        
        if (sensitiveFields.some(field => lowerKey.includes(field))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]);
        }
      }
    }
  };
  
  sanitizeObject(sanitized);
  return sanitized;
};

// Middleware for critical actions that require additional logging
const auditCriticalAction = (actionDescription) => {
  return async (req, res, next) => {
    try {
      // Log the action attempt
      await database.query(`
        INSERT INTO audit_logs 
        (tenant_id, user_id, action, resource_type, details, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        req.tenantId || null,
        req.userId || null,
        `${actionDescription} - ATTEMPT`,
        'critical_action',
        JSON.stringify({
          description: actionDescription,
          method: req.method,
          path: req.path,
          body: sanitizeBody(req.body)
        }),
        req.ip,
        req.get('User-Agent')
      ]);
      
      next();
    } catch (error) {
      logger.error('Critical action audit failed:', error);
      next();
    }
  };
};

// Get audit logs for a tenant
const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, resource_type, user_id, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE tenant_id = $1';
    let params = [req.tenantId];
    let paramCount = 1;
    
    if (action) {
      whereClause += ` AND action ILIKE $${++paramCount}`;
      params.push(`%${action}%`);
    }
    
    if (resource_type) {
      whereClause += ` AND resource_type = $${++paramCount}`;
      params.push(resource_type);
    }
    
    if (user_id) {
      whereClause += ` AND user_id = $${++paramCount}`;
      params.push(user_id);
    }
    
    if (start_date) {
      whereClause += ` AND created_at >= $${++paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      whereClause += ` AND created_at <= $${++paramCount}`;
      params.push(end_date);
    }
    
    // Get total count
    const countResult = await database.query(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      params
    );
    
    // Get audit logs with user information
    const result = await database.query(`
      SELECT 
        al.*,
        u.email as user_email,
        u.first_name,
        u.last_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
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
    
  } catch (error) {
    logger.error('Get audit logs error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve audit logs'
    });
  }
};

module.exports = {
  auditMiddleware,
  auditCriticalAction,
  getAuditLogs
};