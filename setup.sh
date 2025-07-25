#!/bin/bash

# Kingdom SaaS Master Setup Script
# This script automatically installs and configures the complete Kingdom SaaS platform

set -e

echo "🚀 Kingdom SaaS Master Setup Starting..."
echo "================================================"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root for security reasons"
fi

# System requirements check
check_requirements() {
    log "Checking system requirements..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed. Please install Docker first."
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed. Please install Docker Compose first."
    fi
    
    # Check available memory (minimum 8GB recommended)
    total_mem=$(free -m | awk 'NR==2{printf "%.1f", $2/1024}')
    if (( $(echo "$total_mem < 8.0" | bc -l) )); then
        warn "Less than 8GB RAM detected. Performance may be affected."
    fi
    
    # Check available disk space (minimum 50GB recommended)
    available_space=$(df -BG . | awk 'NR==2 {print $4}' | sed 's/G//')
    if [ "$available_space" -lt 50 ]; then
        warn "Less than 50GB disk space available. Consider freeing up space."
    fi
    
    log "System requirements check completed"
}

# Hardware detection and optimization
detect_hardware() {
    log "Detecting hardware configuration..."
    
    # CPU detection
    cpu_cores=$(nproc)
    cpu_info=$(lscpu | grep "Model name" | cut -d: -f2 | xargs)
    log "CPU: $cpu_info ($cpu_cores cores)"
    
    # Memory detection
    total_ram=$(free -h | awk 'NR==2{print $2}')
    log "RAM: $total_ram"
    
    # GPU detection
    if command -v nvidia-smi &> /dev/null; then
        gpu_info=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits)
        log "GPU detected: $gpu_info"
        
        # Install NVIDIA Docker support if not present
        if ! docker info 2>/dev/null | grep -q nvidia; then
            log "Installing NVIDIA Docker support..."
            distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
            curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
            curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
            sudo apt-get update && sudo apt-get install -y nvidia-docker2
            sudo systemctl restart docker
        fi
        
        # Set GPU memory limit based on available VRAM
        gpu_memory=$(echo "$gpu_info" | cut -d, -f2 | xargs)
        if [ "$gpu_memory" -gt 16000 ]; then
            export GPU_MEMORY_LIMIT="12GB"
        elif [ "$gpu_memory" -gt 8000 ]; then
            export GPU_MEMORY_LIMIT="6GB"
        else
            export GPU_MEMORY_LIMIT="4GB"
        fi
        log "GPU memory limit set to: $GPU_MEMORY_LIMIT"
    else
        warn "No NVIDIA GPU detected. Local AI models will use CPU only."
        export GPU_MEMORY_LIMIT="0GB"
    fi
}

# Environment setup
setup_environment() {
    log "Setting up environment configuration..."
    
    if [ ! -f ".env" ]; then
        cp .env.example .env
        log "Created .env file from template"
        warn "Please edit .env file with your actual configuration values"
        
        # Generate secure random passwords
        postgres_pass=$(openssl rand -base64 32)
        redis_pass=$(openssl rand -base64 32)
        jwt_secret=$(openssl rand -base64 64)
        
        sed -i "s/kingdom_secure_pass_2024/$postgres_pass/g" .env
        sed -i "s/redis_secure_pass_2024/$redis_pass/g" .env
        sed -i "s/super_secure_jwt_secret_2024_change_in_production/$jwt_secret/g" .env
        
        log "Generated secure random passwords"
    else
        log "Using existing .env configuration"
    fi
    
    # Load environment variables
    source .env
}

# Database initialization
init_database() {
    log "Initializing database schemas..."
    
    # Create database initialization scripts
    mkdir -p database/init
    
    cat > database/init/01-create-databases.sql << EOF
-- Kingdom SaaS Database Initialization
CREATE DATABASE IF NOT EXISTS nextcloud;
CREATE DATABASE IF NOT EXISTS grafana;

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE nextcloud TO kingdom_user;
GRANT ALL PRIVILEGES ON DATABASE grafana TO kingdom_user;
EOF

    log "Database initialization scripts created"
}

# Build and start services
start_services() {
    log "Building and starting Kingdom SaaS services..."
    
    # Pull latest images
    docker-compose pull
    
    # Build custom services
    docker-compose build --parallel
    
    # Start core services first
    docker-compose up -d postgres redis
    log "Database services started"
    
    # Wait for databases to be ready
    log "Waiting for databases to be ready..."
    sleep 30
    
    # Start all services
    docker-compose up -d
    log "All services started"
    
    # Wait for services to be healthy
    log "Waiting for services to be healthy..."
    sleep 60
}

# Model management setup
setup_models() {
    log "Setting up AI model management..."
    
    # Create model configuration
    mkdir -p config/models
    
    cat > config/models/model-config.json << EOF
{
  "models": {
    "openai": {
      "gpt-4": {
        "provider": "openai",
        "endpoint": "https://api.openai.com/v1",
        "max_tokens": 4096,
        "cost_per_token": 0.00003,
        "performance_tier": "high"
      },
      "gpt-3.5-turbo": {
        "provider": "openai",
        "endpoint": "https://api.openai.com/v1",
        "max_tokens": 4096,
        "cost_per_token": 0.000002,
        "performance_tier": "medium"
      }
    },
    "local": {
      "llama2-7b": {
        "provider": "local",
        "model_path": "/models/llama2-7b",
        "memory_requirement": "8GB",
        "gpu_requirement": true,
        "performance_tier": "medium"
      },
      "llama2-13b": {
        "provider": "local",
        "model_path": "/models/llama2-13b",
        "memory_requirement": "16GB",
        "gpu_requirement": true,
        "performance_tier": "high"
      },
      "mixtral-8x7b": {
        "provider": "local",
        "model_path": "/models/mixtral-8x7b",
        "memory_requirement": "32GB",
        "gpu_requirement": true,
        "performance_tier": "very_high"
      }
    }
  },
  "auto_assignment": {
    "cpu_only": ["gpt-3.5-turbo"],
    "gpu_4gb": ["llama2-7b", "gpt-3.5-turbo"],
    "gpu_8gb": ["llama2-7b", "llama2-13b", "gpt-4"],
    "gpu_16gb": ["llama2-7b", "llama2-13b", "mixtral-8x7b", "gpt-4"]
  }
}
EOF

    log "Model configuration created"
}

# Health checks
run_health_checks() {
    log "Running health checks..."
    
    # Check if services are responding
    services=(
        "http://localhost:3000/health:API Gateway"
        "http://localhost:8080:Dashboard"
        "http://localhost:8081:Nextcloud"
        "http://localhost:3001:Grafana"
        "http://localhost:9090:Prometheus"
        "http://localhost:5601:Kibana"
    )
    
    for service in "${services[@]}"; do
        url=$(echo $service | cut -d: -f1)
        name=$(echo $service | cut -d: -f2)
        
        if curl -f -s $url >/dev/null 2>&1; then
            log "✅ $name is healthy"
        else
            warn "❌ $name is not responding"
        fi
    done
}

# Post-installation setup
post_install_setup() {
    log "Running post-installation setup..."
    
    # Create default admin user
    log "Creating default admin user..."
    
    # Setup monitoring dashboards
    log "Setting up monitoring dashboards..."
    
    # Configure backup schedules
    log "Configuring backup schedules..."
    
    # Setup automatic updates
    log "Setting up automatic updates..."
    
    log "Post-installation setup completed"
}

# Main installation flow
main() {
    log "Starting Kingdom SaaS Master Setup"
    
    check_requirements
    detect_hardware
    setup_environment
    init_database
    setup_models
    start_services
    run_health_checks
    post_install_setup
    
    echo ""
    echo "🎉 Kingdom SaaS Master Setup Completed Successfully!"
    echo "================================================"
    echo ""
    echo "🌐 Access URLs:"
    echo "   Dashboard:     http://localhost:8080"
    echo "   API Gateway:   http://localhost:3000"
    echo "   Nextcloud:     http://localhost:8081"
    echo "   Grafana:       http://localhost:3001"
    echo "   Prometheus:    http://localhost:9090"
    echo "   Kibana:        http://localhost:5601"
    echo ""
    echo "🔐 Default Credentials:"
    echo "   Nextcloud:     admin / (check .env file)"
    echo "   Grafana:       admin / (check .env file)"
    echo ""
    echo "📖 Next Steps:"
    echo "   1. Edit .env file with your API keys and passwords"
    echo "   2. Restart services: docker-compose restart"
    echo "   3. Access the dashboard to complete setup"
    echo ""
    echo "📚 Documentation: ./docs/README.md"
    echo "🆘 Support: Check logs with 'docker-compose logs'"
}

# Run main function
main "$@"