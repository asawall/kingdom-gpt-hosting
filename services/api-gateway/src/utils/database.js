const { Pool } = require('pg');
const logger = require('./logger');

class Database {
  constructor() {
    this.pool = null;
  }

  async connect() {
    if (this.pool) {
      return this.pool;
    }

    try {
      this.pool = new Pool({
        connectionString: process.env.POSTGRES_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      logger.info('Database connection established');
      
      // Initialize schema
      await this.initializeSchema();
      
      return this.pool;
    } catch (error) {
      logger.error('Database connection failed:', error);
      throw error;
    }
  }

  async initializeSchema() {
    const client = await this.pool.connect();
    
    try {
      // Enable UUID extension
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
      
      // Tenants table
      await client.query(`
        CREATE TABLE IF NOT EXISTS tenants (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(255) NOT NULL,
          domain VARCHAR(255) UNIQUE,
          settings JSONB DEFAULT '{}',
          subscription_plan VARCHAR(50) DEFAULT 'free',
          subscription_status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          role VARCHAR(50) DEFAULT 'user',
          permissions JSONB DEFAULT '[]',
          settings JSONB DEFAULT '{}',
          email_verified BOOLEAN DEFAULT FALSE,
          email_verification_token VARCHAR(255),
          password_reset_token VARCHAR(255),
          password_reset_expires TIMESTAMP WITH TIME ZONE,
          last_login TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Teams table
      await client.query(`
        CREATE TABLE IF NOT EXISTS teams (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          settings JSONB DEFAULT '{}',
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Team members table
      await client.query(`
        CREATE TABLE IF NOT EXISTS team_members (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          role VARCHAR(50) DEFAULT 'member',
          permissions JSONB DEFAULT '[]',
          added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(team_id, user_id)
        )
      `);
      
      // AI Models table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_models (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(255) NOT NULL,
          provider VARCHAR(100) NOT NULL,
          model_type VARCHAR(100) NOT NULL,
          configuration JSONB DEFAULT '{}',
          performance_tier VARCHAR(50),
          cost_per_token DECIMAL(10, 8),
          max_tokens INTEGER,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // AI Jobs table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_jobs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          model_id UUID REFERENCES ai_models(id),
          prompt TEXT NOT NULL,
          response TEXT,
          status VARCHAR(50) DEFAULT 'pending',
          error_message TEXT,
          tokens_used INTEGER,
          cost DECIMAL(10, 6),
          processing_time INTEGER,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE
        )
      `);
      
      // Files table
      await client.query(`
        CREATE TABLE IF NOT EXISTS files (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          filename VARCHAR(255) NOT NULL,
          original_filename VARCHAR(255) NOT NULL,
          mime_type VARCHAR(255),
          size BIGINT,
          storage_path VARCHAR(500),
          storage_provider VARCHAR(50) DEFAULT 'local',
          metadata JSONB DEFAULT '{}',
          is_public BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Webhooks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS webhooks (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          url VARCHAR(500) NOT NULL,
          events TEXT[] NOT NULL,
          secret VARCHAR(255),
          is_active BOOLEAN DEFAULT TRUE,
          retry_count INTEGER DEFAULT 0,
          last_triggered TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Audit logs table
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          action VARCHAR(255) NOT NULL,
          resource_type VARCHAR(100),
          resource_id UUID,
          details JSONB DEFAULT '{}',
          ip_address INET,
          user_agent TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Payment transactions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS payment_transactions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          stripe_payment_intent_id VARCHAR(255),
          amount INTEGER NOT NULL,
          currency VARCHAR(3) DEFAULT 'USD',
          status VARCHAR(50) DEFAULT 'pending',
          description TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Create indexes for better performance
      await client.query('CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_teams_tenant_id ON teams(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_id ON ai_jobs(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_id ON ai_jobs(user_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_files_tenant_id ON files(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)');
      
      logger.info('Database schema initialized successfully');
      
    } catch (error) {
      logger.error('Schema initialization failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async query(text, params) {
    const start = Date.now();
    
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Executed query', { text, duration, rows: result.rowCount });
      return result;
    } catch (error) {
      logger.error('Query error', { text, error: error.message });
      throw error;
    }
  }

  async getClient() {
    return await this.pool.connect();
  }

  async end() {
    if (this.pool) {
      await this.pool.end();
      logger.info('Database connection pool closed');
    }
  }
}

module.exports = new Database();