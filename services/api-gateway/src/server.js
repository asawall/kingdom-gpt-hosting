const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const swaggerUi = require('swagger-ui-express');
const WebSocket = require('ws');
const http = require('http');
const jwt = require('jsonwebtoken');

const logger = require('./utils/logger');
const database = require('./utils/database');
const redis = require('./utils/redis');
const authMiddleware = require('./middleware/auth');
const tenantMiddleware = require('./middleware/tenant');
const auditMiddleware = require('./middleware/audit');
const errorHandler = require('./middleware/errorHandler');

// Import route handlers
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const tenantRoutes = require('./routes/tenants');
const aiRoutes = require('./routes/ai');
const webhookRoutes = require('./routes/webhooks');
const healthRoutes = require('./routes/health');

require('dotenv').config();

const app = express();
const server = http.createServer(app);

// WebSocket server for real-time features
const wss = new WebSocket.Server({ server });

// Basic middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:8080'],
  credentials: true
}));

app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});

app.use('/api', limiter);

// API Documentation
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Kingdom SaaS API',
    version: '1.0.0',
    description: 'Comprehensive SaaS platform with AI integration'
  },
  servers: [
    {
      url: process.env.API_URL || 'http://localhost:3000',
      description: 'Development server'
    }
  ]
};

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Health check endpoint (no auth required)
app.use('/health', healthRoutes);

// Authentication routes (no auth required for login/register)
app.use('/api/auth', authRoutes);

// Protected routes with authentication and tenant isolation
app.use('/api', authMiddleware);
app.use('/api', tenantMiddleware);
app.use('/api', auditMiddleware);

// API routes
app.use('/api/users', userRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/webhooks', webhookRoutes);

// Service proxies for microservices
const services = {
  '/api/payments': {
    target: 'http://payment-service:3000',
    changeOrigin: true,
    pathRewrite: { '^/api/payments': '' }
  },
  '/api/email': {
    target: 'http://email-service:3000',
    changeOrigin: true,
    pathRewrite: { '^/api/email': '' }
  },
  '/api/files': {
    target: 'http://nextcloud:80',
    changeOrigin: true,
    pathRewrite: { '^/api/files': '/remote.php/dav' }
  }
};

// Setup service proxies
Object.entries(services).forEach(([path, config]) => {
  app.use(path, createProxyMiddleware(config));
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  logger.info('New WebSocket connection established');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      // Authenticate WebSocket connection
      if (data.type === 'auth' && data.token) {
        try {
          const decoded = jwt.verify(data.token, process.env.JWT_SECRET);
          ws.userId = decoded.userId;
          ws.tenantId = decoded.tenantId;
          ws.send(JSON.stringify({ type: 'auth', status: 'success' }));
          logger.info(`WebSocket authenticated for user ${ws.userId}`);
        } catch (error) {
          ws.send(JSON.stringify({ type: 'auth', status: 'error', message: 'Invalid token' }));
          ws.close();
        }
      }
      
      // Handle real-time AI processing updates
      if (data.type === 'ai_status' && ws.userId) {
        // Broadcast AI processing status to user
        const statusUpdate = {
          type: 'ai_status',
          jobId: data.jobId,
          status: data.status,
          progress: data.progress,
          result: data.result
        };
        
        ws.send(JSON.stringify(statusUpdate));
      }
      
    } catch (error) {
      logger.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });
  
  ws.on('close', () => {
    logger.info('WebSocket connection closed');
  });
  
  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
  });
});

// Broadcast function for real-time updates
const broadcast = (tenantId, message) => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.tenantId === tenantId) {
      client.send(JSON.stringify(message));
    }
  });
};

// Make broadcast function available globally
app.locals.broadcast = broadcast;

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Close database connections
    database.end();
    redis.quit();
    
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // Initialize database
    await database.connect();
    logger.info('Database connected successfully');
    
    // Initialize Redis
    await redis.connect();
    logger.info('Redis connected successfully');
    
    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Kingdom SaaS API Gateway running on port ${PORT}`);
      logger.info(`API Documentation available at http://localhost:${PORT}/api-docs`);
      logger.info(`Health check available at http://localhost:${PORT}/health`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server, wss };