-- Kingdom SaaS Database Initialization

-- Create databases for integrated services
CREATE DATABASE IF NOT EXISTS nextcloud;
CREATE DATABASE IF NOT EXISTS grafana;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Grant permissions to kingdom_user
GRANT ALL PRIVILEGES ON DATABASE kingdom_saas TO kingdom_user;
GRANT ALL PRIVILEGES ON DATABASE nextcloud TO kingdom_user;
GRANT ALL PRIVILEGES ON DATABASE grafana TO kingdom_user;

-- Insert default AI models
INSERT INTO ai_models (name, provider, model_type, configuration, performance_tier, cost_per_token, max_tokens, is_active) VALUES
('gpt-4', 'openai', 'text-generation', '{"endpoint": "https://api.openai.com/v1", "context_length": 8192}', 'high', 0.00003, 4096, true),
('gpt-3.5-turbo', 'openai', 'text-generation', '{"endpoint": "https://api.openai.com/v1", "context_length": 4096}', 'medium', 0.000002, 4096, true),
('llama2-7b', 'local', 'text-generation', '{"model_path": "/models/llama2-7b", "memory_requirement": "8GB", "gpu_requirement": true}', 'medium', 0.0, 2048, true),
('llama2-13b', 'local', 'text-generation', '{"model_path": "/models/llama2-13b", "memory_requirement": "16GB", "gpu_requirement": true}', 'high', 0.0, 2048, true),
('mixtral-8x7b', 'local', 'text-generation', '{"model_path": "/models/mixtral-8x7b", "memory_requirement": "32GB", "gpu_requirement": true}', 'very_high', 0.0, 4096, true)
ON CONFLICT (name) DO NOTHING;

-- Insert default system webhooks
INSERT INTO webhooks (id, tenant_id, name, url, events, secret, is_active) VALUES
(uuid_generate_v4(), NULL, 'System Health Monitor', 'http://localhost:3001/webhooks/health', '{"system.error", "system.warning"}', 'system_webhook_secret', true),
(uuid_generate_v4(), NULL, 'Payment Processor', 'http://payment-service:3000/webhooks/stripe', '{"payment.succeeded", "payment.failed"}', 'payment_webhook_secret', true)
ON CONFLICT DO NOTHING;

-- Create indexes for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_jobs_created_at ON ai_jobs(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_jobs_completed_at ON ai_jobs(completed_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_transactions_created_at ON payment_transactions(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_files_created_at ON files(created_at);

-- Update statistics
ANALYZE;

-- Log initialization completion
DO $$
BEGIN
    RAISE NOTICE 'Kingdom SaaS database initialization completed successfully at %', NOW();
END
$$;