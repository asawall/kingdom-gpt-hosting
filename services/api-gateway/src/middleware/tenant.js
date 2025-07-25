const database = require('../utils/database');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

const tenantMiddleware = async (req, res, next) => {
  try {
    if (!req.tenantId) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'Tenant information missing'
      });
    }

    // Try to get tenant from cache first
    let tenant = await redis.getCachedTenant(req.tenantId);
    
    if (!tenant) {
      // Fetch tenant from database
      const result = await database.query(
        'SELECT id, name, domain, settings, subscription_plan, subscription_status FROM tenants WHERE id = $1',
        [req.tenantId]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Tenant not found'
        });
      }
      
      tenant = result.rows[0];
      
      // Cache tenant for 1 hour
      await redis.cacheTenant(req.tenantId, tenant, 3600);
    }

    // Check if tenant subscription is active
    if (tenant.subscription_status !== 'active') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Tenant subscription is not active'
      });
    }

    // Attach tenant info to request
    req.tenant = tenant;
    
    // Add tenant isolation to database queries
    req.tenantQuery = (query, params = []) => {
      // Automatically add tenant_id to WHERE clause for data isolation
      const tenantParams = [req.tenantId, ...params];
      
      // Simple query modification for tenant isolation
      // In production, consider using a query builder for more complex scenarios
      if (query.toLowerCase().includes('where')) {
        const modifiedQuery = query.replace(/where/i, 'WHERE tenant_id = $1 AND');
        return database.query(modifiedQuery, tenantParams);
      } else if (query.toLowerCase().includes('from')) {
        const modifiedQuery = query.replace(/from\s+(\w+)/i, 'FROM $1 WHERE tenant_id = $1');
        return database.query(modifiedQuery, tenantParams);
      } else {
        return database.query(query, params);
      }
    };

    next();
  } catch (error) {
    logger.error('Tenant middleware error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Tenant validation failed'
    });
  }
};

// Middleware to check subscription limits
const checkSubscriptionLimits = (feature) => {
  return async (req, res, next) => {
    try {
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
      const limit = planLimits[feature];
      
      if (limit === -1) {
        // Unlimited for this plan
        return next();
      }
      
      // Check current usage based on feature
      let currentUsage = 0;
      
      switch (feature) {
        case 'ai_requests_per_month':
          const startOfMonth = new Date();
          startOfMonth.setDate(1);
          startOfMonth.setHours(0, 0, 0, 0);
          
          const result = await database.query(
            'SELECT COUNT(*) as count FROM ai_jobs WHERE tenant_id = $1 AND created_at >= $2',
            [req.tenantId, startOfMonth]
          );
          currentUsage = parseInt(result.rows[0].count);
          break;
          
        case 'team_members':
          const teamResult = await database.query(
            'SELECT COUNT(DISTINCT user_id) as count FROM team_members tm JOIN teams t ON tm.team_id = t.id WHERE t.tenant_id = $1',
            [req.tenantId]
          );
          currentUsage = parseInt(teamResult.rows[0].count);
          break;
          
        case 'webhooks':
          const webhookResult = await database.query(
            'SELECT COUNT(*) as count FROM webhooks WHERE tenant_id = $1 AND is_active = true',
            [req.tenantId]
          );
          currentUsage = parseInt(webhookResult.rows[0].count);
          break;
          
        case 'storage_gb':
          const storageResult = await database.query(
            'SELECT COALESCE(SUM(size), 0) as total_size FROM files WHERE tenant_id = $1',
            [req.tenantId]
          );
          currentUsage = Math.ceil(parseInt(storageResult.rows[0].total_size) / (1024 * 1024 * 1024)); // Convert to GB
          break;
      }
      
      if (currentUsage >= limit) {
        return res.status(403).json({
          error: 'Subscription limit exceeded',
          message: `Your ${subscriptionPlan} plan allows ${limit} ${feature.replace('_', ' ')}, but you have reached this limit.`,
          current_usage: currentUsage,
          limit: limit,
          upgrade_url: '/api/payments/upgrade'
        });
      }
      
      // Add usage info to request
      req.usageInfo = {
        feature,
        current_usage: currentUsage,
        limit,
        remaining: limit - currentUsage
      };
      
      next();
    } catch (error) {
      logger.error('Subscription limit check error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to check subscription limits'
      });
    }
  };
};

// Domain-based tenant resolution middleware
const resolveTenantByDomain = async (req, res, next) => {
  try {
    const host = req.get('Host') || req.get('X-Forwarded-Host');
    
    if (!host) {
      return next();
    }
    
    // Extract domain (remove port if present)
    const domain = host.split(':')[0];
    
    // Skip localhost and IP addresses
    if (domain === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(domain)) {
      return next();
    }
    
    // Try to get tenant by domain
    const result = await database.query(
      'SELECT id, name, domain, settings, subscription_plan, subscription_status FROM tenants WHERE domain = $1',
      [domain]
    );
    
    if (result.rows.length > 0) {
      const tenant = result.rows[0];
      req.domainTenant = tenant;
      
      // Cache tenant by domain
      await redis.set(`tenant:domain:${domain}`, tenant, 3600);
    }
    
    next();
  } catch (error) {
    logger.error('Domain tenant resolution error:', error);
    next();
  }
};

module.exports = {
  tenantMiddleware,
  checkSubscriptionLimits,
  resolveTenantByDomain
};