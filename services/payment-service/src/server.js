const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const Stripe = require('stripe');

const logger = require('./utils/logger');
const database = require('./utils/database');
const redis = require('./utils/redis');

// Import routes
const subscriptionRoutes = require('./routes/subscriptions');
const webhookRoutes = require('./routes/webhooks');
const paymentMethodRoutes = require('./routes/paymentMethods');
const healthRoutes = require('./routes/health');

require('dotenv').config();

const app = express();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-08-16',
});

// Webhook middleware (before body parsing)
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

// Basic middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make stripe available to routes
app.locals.stripe = stripe;

// Health check
app.use('/health', healthRoutes);

// API routes
app.use('/subscriptions', subscriptionRoutes);
app.use('/payment-methods', paymentMethodRoutes);

// Error handling
app.use((err, req, res, next) => {
  logger.error('Payment service error:', err);
  
  if (err.type === 'StripeError') {
    return res.status(400).json({
      error: 'Payment error',
      message: err.message,
      type: err.type
    });
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

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
  
  try {
    await database.end();
    await redis.quit();
    logger.info('Payment service shutdown completed');
  } catch (error) {
    logger.error('Error during shutdown:', error);
  }
  
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // Initialize database
    await database.connect();
    logger.info('Database connected');
    
    // Initialize Redis
    await redis.connect();
    logger.info('Redis connected');
    
    // Initialize Stripe products and prices
    await initializeStripeProducts();
    
    app.listen(PORT, () => {
      logger.info(`Payment service running on port ${PORT}`);
    });
    
  } catch (error) {
    logger.error('Failed to start payment service:', error);
    process.exit(1);
  }
};

// Initialize Stripe products and prices
async function initializeStripeProducts() {
  try {
    const products = [
      {
        id: 'kingdom-basic',
        name: 'Kingdom SaaS Basic',
        description: 'Basic plan with limited features',
        prices: [
          {
            id: 'price-basic-monthly',
            unit_amount: 2900, // $29.00
            currency: 'usd',
            recurring: { interval: 'month' }
          },
          {
            id: 'price-basic-yearly',
            unit_amount: 29000, // $290.00 (2 months free)
            currency: 'usd',
            recurring: { interval: 'year' }
          }
        ]
      },
      {
        id: 'kingdom-pro',
        name: 'Kingdom SaaS Pro',
        description: 'Professional plan with advanced features',
        prices: [
          {
            id: 'price-pro-monthly',
            unit_amount: 9900, // $99.00
            currency: 'usd',
            recurring: { interval: 'month' }
          },
          {
            id: 'price-pro-yearly',
            unit_amount: 99000, // $990.00 (2 months free)
            currency: 'usd',
            recurring: { interval: 'year' }
          }
        ]
      },
      {
        id: 'kingdom-enterprise',
        name: 'Kingdom SaaS Enterprise',
        description: 'Enterprise plan with unlimited features',
        prices: [
          {
            id: 'price-enterprise-monthly',
            unit_amount: 29900, // $299.00
            currency: 'usd',
            recurring: { interval: 'month' }
          },
          {
            id: 'price-enterprise-yearly',
            unit_amount: 299000, // $2990.00 (2 months free)
            currency: 'usd',
            recurring: { interval: 'year' }
          }
        ]
      }
    ];

    for (const productData of products) {
      try {
        // Create or update product
        let product;
        try {
          product = await stripe.products.retrieve(productData.id);
          await stripe.products.update(productData.id, {
            name: productData.name,
            description: productData.description
          });
        } catch (error) {
          if (error.code === 'resource_missing') {
            product = await stripe.products.create({
              id: productData.id,
              name: productData.name,
              description: productData.description
            });
          } else {
            throw error;
          }
        }

        // Create or update prices
        for (const priceData of productData.prices) {
          try {
            await stripe.prices.retrieve(priceData.id);
          } catch (error) {
            if (error.code === 'resource_missing') {
              await stripe.prices.create({
                id: priceData.id,
                product: product.id,
                unit_amount: priceData.unit_amount,
                currency: priceData.currency,
                recurring: priceData.recurring
              });
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to initialize product ${productData.id}:`, error);
      }
    }

    logger.info('Stripe products and prices initialized');
  } catch (error) {
    logger.error('Failed to initialize Stripe products:', error);
  }
}

startServer();

module.exports = app;