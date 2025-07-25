const si = require('systeminformation');
const logger = require('./logger');

class HardwareDetector {
  constructor() {
    this.hardwareInfo = {
      cpu: null,
      memory: null,
      gpu: null,
      os: null
    };
  }

  async detectHardware() {
    try {
      logger.info('Starting hardware detection...');

      // Get CPU information
      const cpu = await si.cpu();
      this.hardwareInfo.cpu = {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
        speedMax: cpu.speedMax
      };

      // Get memory information
      const memory = await si.mem();
      this.hardwareInfo.memory = {
        total: Math.round(memory.total / (1024 * 1024 * 1024)), // GB
        available: Math.round(memory.available / (1024 * 1024 * 1024)), // GB
        used: Math.round(memory.used / (1024 * 1024 * 1024)) // GB
      };

      // Get GPU information
      try {
        const graphics = await si.graphics();
        if (graphics.controllers && graphics.controllers.length > 0) {
          const gpu = graphics.controllers[0];
          this.hardwareInfo.gpu = {
            vendor: gpu.vendor,
            model: gpu.model,
            memory: gpu.vram ? Math.round(gpu.vram / 1024) : 0, // GB
            cores: gpu.cores || null
          };
        }
      } catch (error) {
        logger.warn('Could not detect GPU information:', error.message);
        this.hardwareInfo.gpu = null;
      }

      // Get OS information
      const osInfo = await si.osInfo();
      this.hardwareInfo.os = {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        arch: osInfo.arch
      };

      logger.info('Hardware detection completed:', this.hardwareInfo);
      return this.hardwareInfo;

    } catch (error) {
      logger.error('Hardware detection failed:', error);
      throw error;
    }
  }

  getHardwareInfo() {
    return this.hardwareInfo;
  }

  getCPUInfo() {
    return this.hardwareInfo.cpu;
  }

  getMemoryInfo() {
    return this.hardwareInfo.memory;
  }

  getGPUInfo() {
    return this.hardwareInfo.gpu;
  }

  getOSInfo() {
    return this.hardwareInfo.os;
  }

  hasGPU() {
    return this.hardwareInfo.gpu !== null && this.hardwareInfo.gpu.memory > 0;
  }

  getGPUMemory() {
    return this.hasGPU() ? this.hardwareInfo.gpu.memory : 0;
  }

  getTotalMemory() {
    return this.hardwareInfo.memory ? this.hardwareInfo.memory.total : 0;
  }

  getAvailableMemory() {
    return this.hardwareInfo.memory ? this.hardwareInfo.memory.available : 0;
  }

  getCPUCores() {
    return this.hardwareInfo.cpu ? this.hardwareInfo.cpu.cores : 1;
  }

  // Determine the best configuration for AI models based on hardware
  getOptimalModelConfiguration() {
    const config = {
      canRunLocalModels: false,
      maxModelSize: 'small',
      recommendedProvider: 'openai',
      parallelJobs: 1,
      gpuAcceleration: false
    };

    const totalMemory = this.getTotalMemory();
    const gpuMemory = this.getGPUMemory();
    const cpuCores = this.getCPUCores();

    // Determine if we can run local models
    if (totalMemory >= 8) {
      config.canRunLocalModels = true;
      config.recommendedProvider = 'local';
    }

    // Determine max model size
    if (gpuMemory >= 16 || totalMemory >= 32) {
      config.maxModelSize = 'large';
    } else if (gpuMemory >= 8 || totalMemory >= 16) {
      config.maxModelSize = 'medium';
    }

    // GPU acceleration
    if (this.hasGPU() && gpuMemory >= 4) {
      config.gpuAcceleration = true;
    }

    // Parallel job capacity
    config.parallelJobs = Math.max(1, Math.floor(cpuCores / 2));

    logger.info('Optimal model configuration determined:', config);
    return config;
  }

  // Get hardware score for model assignment
  getHardwareScore() {
    let score = 0;
    
    // CPU score (max 30 points)
    const cpuCores = this.getCPUCores();
    score += Math.min(30, cpuCores * 3);

    // Memory score (max 40 points)
    const totalMemory = this.getTotalMemory();
    score += Math.min(40, totalMemory * 2);

    // GPU score (max 30 points)
    if (this.hasGPU()) {
      const gpuMemory = this.getGPUMemory();
      score += Math.min(30, gpuMemory * 2);
    }

    return score;
  }

  // Check if hardware meets requirements for a specific model
  meetsRequirements(modelRequirements) {
    const requirements = {
      minMemory: modelRequirements.minMemory || 0,
      minGPUMemory: modelRequirements.minGPUMemory || 0,
      requiresGPU: modelRequirements.requiresGPU || false,
      minCPUCores: modelRequirements.minCPUCores || 1
    };

    const totalMemory = this.getTotalMemory();
    const gpuMemory = this.getGPUMemory();
    const cpuCores = this.getCPUCores();
    const hasGPU = this.hasGPU();

    // Check memory requirements
    if (totalMemory < requirements.minMemory) {
      return false;
    }

    // Check GPU requirements
    if (requirements.requiresGPU && !hasGPU) {
      return false;
    }

    if (requirements.minGPUMemory > 0 && gpuMemory < requirements.minGPUMemory) {
      return false;
    }

    // Check CPU requirements
    if (cpuCores < requirements.minCPUCores) {
      return false;
    }

    return true;
  }

  // Get current system load
  async getCurrentLoad() {
    try {
      const load = await si.currentLoad();
      const memory = await si.mem();
      
      return {
        cpu: load.currentLoad,
        memory: (memory.used / memory.total) * 100,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Failed to get current load:', error);
      return null;
    }
  }

  // Monitor system resources
  async startMonitoring(callback, interval = 5000) {
    const monitor = setInterval(async () => {
      try {
        const load = await this.getCurrentLoad();
        if (callback && load) {
          callback(load);
        }
      } catch (error) {
        logger.error('Monitoring error:', error);
      }
    }, interval);

    return monitor;
  }

  stopMonitoring(monitorHandle) {
    if (monitorHandle) {
      clearInterval(monitorHandle);
    }
  }
}

module.exports = HardwareDetector;