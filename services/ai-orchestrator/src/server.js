const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

const logger = require('./utils/logger');
const database = require('./utils/database');
const redis = require('./utils/redis');
const ModelManager = require('./models/ModelManager');
const HardwareDetector = require('./utils/HardwareDetector');

// Import providers
const OpenAIProvider = require('./providers/OpenAIProvider');
const LocalModelProvider = require('./providers/LocalModelProvider');
const HuggingFaceProvider = require('./providers/HuggingFaceProvider');

// Import routes
const aiRoutes = require('./routes/ai');
const modelsRoutes = require('./routes/models');
const healthRoutes = require('./routes/health');

require('dotenv').config();

const app = express();

// Basic middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.use('/health', healthRoutes);

// API routes
app.use('/api/ai', aiRoutes);
app.use('/api/models', modelsRoutes);

// Global error handler
app.use((err, req, res, next) => {
  logger.error('AI Orchestrator Error:', err);
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

class AIOrchestrator {
  constructor() {
    this.modelManager = null;
    this.hardwareDetector = null;
    this.providers = {};
    this.initialized = false;
  }

  async initialize() {
    try {
      logger.info('Initializing AI Orchestrator...');

      // Initialize database connection
      await database.connect();
      logger.info('Database connected');

      // Initialize Redis connection
      await redis.connect();
      logger.info('Redis connected');

      // Initialize hardware detector
      this.hardwareDetector = new HardwareDetector();
      await this.hardwareDetector.detectHardware();
      logger.info('Hardware detection completed');

      // Initialize model manager
      this.modelManager = new ModelManager(this.hardwareDetector);
      await this.modelManager.initialize();
      logger.info('Model manager initialized');

      // Initialize providers
      await this.initializeProviders();
      logger.info('AI providers initialized');

      // Load and register models
      await this.loadModels();
      logger.info('Models loaded and registered');

      // Schedule periodic tasks
      this.schedulePeriodicTasks();
      logger.info('Periodic tasks scheduled');

      this.initialized = true;
      logger.info('AI Orchestrator initialization completed');

    } catch (error) {
      logger.error('Failed to initialize AI Orchestrator:', error);
      throw error;
    }
  }

  async initializeProviders() {
    // Initialize OpenAI provider
    if (process.env.OPENAI_API_KEY) {
      this.providers.openai = new OpenAIProvider(process.env.OPENAI_API_KEY);
      logger.info('OpenAI provider initialized');
    } else {
      logger.warn('OpenAI API key not provided, OpenAI provider not available');
    }

    // Initialize HuggingFace provider
    if (process.env.HUGGINGFACE_API_KEY) {
      this.providers.huggingface = new HuggingFaceProvider(process.env.HUGGINGFACE_API_KEY);
      logger.info('HuggingFace provider initialized');
    } else {
      logger.warn('HuggingFace API key not provided, HuggingFace provider not available');
    }

    // Initialize local model provider
    this.providers.local = new LocalModelProvider(this.hardwareDetector);
    logger.info('Local model provider initialized');
  }

  async loadModels() {
    try {
      // Load model configuration
      const configPath = path.join(__dirname, '../config/models/model-config.json');
      
      let modelConfig;
      try {
        const configData = await fs.readFile(configPath, 'utf8');
        modelConfig = JSON.parse(configData);
      } catch (error) {
        logger.warn('Model config file not found, using default configuration');
        modelConfig = await this.getDefaultModelConfig();
      }

      // Register models with the database
      await this.registerModels(modelConfig);

      // Auto-assign models based on hardware
      await this.autoAssignModels(modelConfig);

      logger.info('Model loading completed');
    } catch (error) {
      logger.error('Failed to load models:', error);
      throw error;
    }
  }

  async getDefaultModelConfig() {
    return {
      models: {
        openai: {
          "gpt-4": {
            provider: "openai",
            endpoint: "https://api.openai.com/v1",
            max_tokens: 4096,
            cost_per_token: 0.00003,
            performance_tier: "high"
          },
          "gpt-3.5-turbo": {
            provider: "openai",
            endpoint: "https://api.openai.com/v1",
            max_tokens: 4096,
            cost_per_token: 0.000002,
            performance_tier: "medium"
          }
        },
        local: {
          "llama2-7b": {
            provider: "local",
            model_path: "/models/llama2-7b",
            memory_requirement: "8GB",
            gpu_requirement: true,
            performance_tier: "medium"
          },
          "llama2-13b": {
            provider: "local",
            model_path: "/models/llama2-13b",
            memory_requirement: "16GB",
            gpu_requirement: true,
            performance_tier: "high"
          }
        }
      },
      auto_assignment: {
        cpu_only: ["gpt-3.5-turbo"],
        gpu_4gb: ["llama2-7b", "gpt-3.5-turbo"],
        gpu_8gb: ["llama2-7b", "llama2-13b", "gpt-4"],
        gpu_16gb: ["llama2-7b", "llama2-13b", "gpt-4"]
      }
    };
  }

  async registerModels(modelConfig) {
    const models = [];
    
    // Process OpenAI models
    if (modelConfig.models.openai) {
      for (const [name, config] of Object.entries(modelConfig.models.openai)) {
        models.push({
          name,
          provider: config.provider,
          model_type: 'text-generation',
          configuration: config,
          performance_tier: config.performance_tier,
          cost_per_token: config.cost_per_token,
          max_tokens: config.max_tokens
        });
      }
    }

    // Process local models
    if (modelConfig.models.local) {
      for (const [name, config] of Object.entries(modelConfig.models.local)) {
        models.push({
          name,
          provider: config.provider,
          model_type: 'text-generation',
          configuration: config,
          performance_tier: config.performance_tier,
          cost_per_token: 0, // Local models have no cost per token
          max_tokens: config.max_tokens || 2048
        });
      }
    }

    // Insert/update models in database
    for (const model of models) {
      await database.query(`
        INSERT INTO ai_models (name, provider, model_type, configuration, performance_tier, cost_per_token, max_tokens)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (name) DO UPDATE SET
          configuration = EXCLUDED.configuration,
          performance_tier = EXCLUDED.performance_tier,
          cost_per_token = EXCLUDED.cost_per_token,
          max_tokens = EXCLUDED.max_tokens,
          updated_at = NOW()
      `, [
        model.name,
        model.provider,
        model.model_type,
        JSON.stringify(model.configuration),
        model.performance_tier,
        model.cost_per_token,
        model.max_tokens
      ]);
    }

    logger.info(`Registered ${models.length} models in database`);
  }

  async autoAssignModels(modelConfig) {
    const hardware = this.hardwareDetector.getHardwareInfo();
    const gpuMemory = hardware.gpu ? hardware.gpu.memory : 0;
    
    let category;
    if (!hardware.gpu || gpuMemory === 0) {
      category = 'cpu_only';
    } else if (gpuMemory <= 4) {
      category = 'gpu_4gb';
    } else if (gpuMemory <= 8) {
      category = 'gpu_8gb';
    } else {
      category = 'gpu_16gb';
    }

    const assignedModels = modelConfig.auto_assignment[category] || modelConfig.auto_assignment.cpu_only;
    
    // Store assigned models in Redis for quick access
    await redis.set('assigned_models', assignedModels, 3600);
    
    logger.info(`Auto-assigned models for ${category}: ${assignedModels.join(', ')}`);
  }

  schedulePeriodicTasks() {
    // Update model availability every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        await this.updateModelAvailability();
      } catch (error) {
        logger.error('Failed to update model availability:', error);
      }
    });

    // Clean up old jobs every hour
    cron.schedule('0 * * * *', async () => {
      try {
        await this.cleanupOldJobs();
      } catch (error) {
        logger.error('Failed to cleanup old jobs:', error);
      }
    });

    // Check for model updates daily
    cron.schedule('0 2 * * *', async () => {
      try {
        await this.checkForModelUpdates();
      } catch (error) {
        logger.error('Failed to check for model updates:', error);
      }
    });

    logger.info('Periodic tasks scheduled');
  }

  async updateModelAvailability() {
    // Check which models are currently available
    const models = await database.query('SELECT * FROM ai_models WHERE is_active = true');
    
    for (const model of models.rows) {
      const provider = this.providers[model.provider];
      if (provider) {
        const isAvailable = await provider.checkAvailability(model.name);
        await redis.hSet('model_availability', model.name, isAvailable);
      }
    }
  }

  async cleanupOldJobs() {
    // Remove completed jobs older than 30 days
    const result = await database.query(`
      DELETE FROM ai_jobs 
      WHERE status IN ('completed', 'failed') 
      AND completed_at < NOW() - INTERVAL '30 days'
    `);
    
    logger.info(`Cleaned up ${result.rowCount} old AI jobs`);
  }

  async checkForModelUpdates() {
    // Check for updates to local models
    const localProvider = this.providers.local;
    if (localProvider) {
      await localProvider.checkForUpdates();
    }
  }

  getProvider(providerName) {
    return this.providers[providerName];
  }

  getModelManager() {
    return this.modelManager;
  }

  getHardwareDetector() {
    return this.hardwareDetector;
  }

  isInitialized() {
    return this.initialized;
  }
}

// Create global orchestrator instance
const orchestrator = new AIOrchestrator();

// Make orchestrator available globally
app.locals.orchestrator = orchestrator;

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    await database.end();
    await redis.quit();
    logger.info('AI Orchestrator shutdown completed');
  } catch (error) {
    logger.error('Error during shutdown:', error);
  }
  
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await orchestrator.initialize();
    
    app.listen(PORT, () => {
      logger.info(`AI Orchestrator running on port ${PORT}`);
    });
    
  } catch (error) {
    logger.error('Failed to start AI Orchestrator:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, orchestrator };