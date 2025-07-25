# Kingdom SaaS Master-Setup

🚀 **Production-Ready SaaS Platform with AI Integration**

A comprehensive, fully-automated SaaS platform featuring AI/GPT integration, multi-tenancy, team management, payment processing, and enterprise-grade monitoring.

## 🎯 Features

### Core Infrastructure
- **Multi-tenant Architecture** with complete data isolation
- **JWT Authentication** with role-based access control
- **API Gateway** with rate limiting and request routing
- **Real-time WebSocket** support for live updates
- **Comprehensive Audit Logging** for compliance

### AI/GPT Integration
- **OpenAI Integration** (GPT-4, GPT-3.5-turbo)
- **Local Model Support** (Llama2, MPT, Mixtral)
- **Hardware Detection** and automatic model assignment
- **Performance-based** server distribution
- **Streaming Responses** with real-time updates
- **Cost Tracking** and usage analytics

### SaaS Features
- **User & Team Management** with permissions
- **Subscription Management** with Stripe integration
- **File Management** with Nextcloud integration
- **Webhook System** with signature verification
- **Email Notifications** and automated workflows

### Monitoring & Operations
- **Grafana Dashboards** for metrics visualization
- **Prometheus Monitoring** for system metrics
- **ELK Stack** for centralized logging
- **Automated Backups** to S3-compatible storage
- **Health Checks** and alerting

### DevOps & Deployment
- **Docker Containerization** with multi-stage builds
- **docker-compose** for local development
- **Kubernetes Ready** (manifests included)
- **Auto-scaling** configuration
- **CI/CD Pipeline** support

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- 8GB+ RAM (16GB+ recommended for local AI models)
- GPU support (optional, for local AI models)

### One-Command Setup

```bash
git clone https://github.com/asawall/kingdom-gpt-hosting.git
cd kingdom-gpt-hosting
chmod +x setup.sh
./setup.sh
```

The setup script will:
1. Detect your hardware configuration
2. Install and configure all services
3. Set up databases and caching
4. Configure monitoring and logging
5. Start all services automatically

### Manual Setup

1. **Clone and Configure**
   ```bash
   git clone https://github.com/asawall/kingdom-gpt-hosting.git
   cd kingdom-gpt-hosting
   cp .env.example .env
   # Edit .env with your API keys and passwords
   ```

2. **Start Services**
   ```bash
   docker-compose up -d
   ```

3. **Verify Installation**
   ```bash
   # Check service health
   curl http://localhost:3000/health
   
   # Access dashboard
   open http://localhost:8080
   ```

## 🔧 Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Database
POSTGRES_PASSWORD=your_secure_password
REDIS_PASSWORD=your_redis_password

# JWT Security
JWT_SECRET=your_jwt_secret

# AI Services
OPENAI_API_KEY=your_openai_key
HUGGINGFACE_API_KEY=your_huggingface_key

# Payment Processing
STRIPE_SECRET_KEY=your_stripe_secret
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password

# Cloud Storage (for backups)
S3_BUCKET=your-backup-bucket
S3_ACCESS_KEY=your_s3_access_key
S3_SECRET_KEY=your_s3_secret_key
```

### Hardware Optimization

The system automatically detects your hardware and optimizes AI model assignment:

- **CPU Only**: Uses OpenAI API models
- **4GB GPU**: Enables small local models + OpenAI
- **8GB+ GPU**: Enables medium local models
- **16GB+ GPU**: Enables large local models (Mixtral-8x7b)

## 📊 Access URLs

After deployment, access these services:

| Service | URL | Description |
|---------|-----|-------------|
| **Dashboard** | http://localhost:8080 | Main SaaS dashboard |
| **API Gateway** | http://localhost:3000 | REST API endpoints |
| **Grafana** | http://localhost:3001 | Monitoring dashboards |
| **Prometheus** | http://localhost:9090 | Metrics collection |
| **Kibana** | http://localhost:5601 | Log analysis |
| **Nextcloud** | http://localhost:8081 | File management |

### Default Credentials

- **Grafana**: admin / (see .env file)
- **Nextcloud**: admin / (see .env file)

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Dashboard     │────│   API Gateway   │────│ AI Orchestrator │
│   (React)       │    │   (Node.js)     │    │   (Node.js)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                       ┌────────┴────────┐              │
                       │                 │              │
              ┌─────────────────┐ ┌─────────────────┐    │
              │  User Service   │ │ Payment Service │    │
              │   (Node.js)     │ │   (Node.js)     │    │
              └─────────────────┘ └─────────────────┘    │
                       │                 │              │
              ┌─────────┴─────────────────┴──────────────┴────┐
              │                                               │
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │   PostgreSQL    │ │      Redis      │ │   File Storage  │
    │   (Database)    │ │    (Cache)      │ │   (Nextcloud)   │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
              │                 │                        │
    ┌─────────┴─────────────────┴────────────────────────┴────┐
    │                Monitoring Stack                         │
    │  Prometheus + Grafana + ELK + Alertmanager             │
    └─────────────────────────────────────────────────────────┘
```

## 📖 API Documentation

API documentation is available at: http://localhost:3000/api-docs

### Key Endpoints

- **Authentication**: `/api/auth/*`
- **Users**: `/api/users/*`
- **Teams**: `/api/tenants/teams/*`
- **AI Processing**: `/api/ai/*`
- **Webhooks**: `/api/webhooks/*`
- **Files**: `/api/files/*`
- **Payments**: `/api/payments/*`

## 🤖 AI Integration

### Supported Models

**OpenAI Models:**
- GPT-4 (high performance, higher cost)
- GPT-3.5-turbo (medium performance, low cost)

**Local Models:**
- Llama2-7B (medium performance, free)
- Llama2-13B (high performance, free)
- Mixtral-8x7B (very high performance, free)

### Usage Examples

```javascript
// Process AI request
const response = await fetch('/api/ai/process', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: 'Explain quantum computing',
    model: 'gpt-4',
    options: {
      maxTokens: 1000,
      temperature: 0.7
    }
  })
})

// Stream AI response
const eventSource = new EventSource('/api/ai/stream', {
  method: 'POST',
  body: JSON.stringify({
    prompt: 'Write a story about AI',
    model: 'llama2-7b'
  })
})
```

## 💳 Subscription Plans

| Plan | Price | AI Requests/Month | Storage | Team Members | Webhooks |
|------|-------|-------------------|---------|--------------|----------|
| **Free** | $0 | 100 | 1GB | 3 | 1 |
| **Basic** | $29/mo | 1,000 | 10GB | 10 | 5 |
| **Pro** | $99/mo | 10,000 | 100GB | 50 | 25 |
| **Enterprise** | $299/mo | Unlimited | Unlimited | Unlimited | Unlimited |

## 🔒 Security Features

- **JWT Authentication** with secure token management
- **Role-based Access Control** (RBAC)
- **Multi-tenant Data Isolation**
- **Rate Limiting** and DDoS protection
- **Input Validation** and sanitization
- **Audit Logging** for compliance
- **Encrypted Storage** for sensitive data
- **HTTPS/TLS** encryption in transit

## 📈 Monitoring & Analytics

### Metrics Tracked

- **System Performance**: CPU, Memory, Disk, Network
- **API Performance**: Response times, error rates, throughput
- **AI Usage**: Token consumption, model performance, costs
- **User Activity**: Login patterns, feature usage
- **Business Metrics**: Revenue, subscription changes, growth

### Alerting

Automated alerts for:
- High error rates
- Performance degradation
- Resource exhaustion
- Security incidents
- Payment failures

## 🛠️ Development

### Local Development

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up

# Install dependencies
cd services/api-gateway && npm install
cd services/ai-orchestrator && npm install
cd frontend/dashboard && npm install

# Run tests
npm test

# Lint code
npm run lint
```

### Adding New Services

1. Create service directory in `services/`
2. Add Dockerfile and package.json
3. Update docker-compose.yml
4. Add service routes to API Gateway
5. Update monitoring configuration

## 🚀 Production Deployment

### Kubernetes

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/

# Scale services
kubectl scale deployment api-gateway --replicas=3
```

### Environment-specific Configuration

- **Development**: Local Docker Compose
- **Staging**: Kubernetes with limited resources
- **Production**: Kubernetes with auto-scaling

## 📚 Documentation

- [API Reference](docs/api.md)
- [Frontend Guide](docs/frontend.md)
- [Deployment Guide](docs/deployment.md)
- [Monitoring Setup](docs/monitoring.md)
- [Troubleshooting](docs/troubleshooting.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check the `/docs` directory
- **Issues**: Create a GitHub issue
- **Enterprise Support**: Contact us for dedicated support

---

**Built with ❤️ for the future of AI-powered SaaS platforms**
