const OpenAI = require('openai');
const logger = require('../utils/logger');

class OpenAIProvider {
  constructor(apiKey) {
    this.client = new OpenAI({
      apiKey: apiKey
    });
    this.provider = 'openai';
  }

  async generateText(prompt, options = {}) {
    try {
      const {
        model = 'gpt-3.5-turbo',
        maxTokens = 1000,
        temperature = 0.7,
        stream = false
      } = options;

      logger.info(`OpenAI request: ${model}, tokens: ${maxTokens}`);

      const response = await this.client.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        stream: stream
      });

      const result = {
        provider: this.provider,
        model: model,
        response: response.choices[0].message.content,
        usage: {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens
        },
        cost: this.calculateCost(model, response.usage.total_tokens)
      };

      logger.info(`OpenAI response completed, tokens used: ${result.usage.total_tokens}`);
      return result;

    } catch (error) {
      logger.error('OpenAI request failed:', error);
      throw error;
    }
  }

  async generateTextStream(prompt, options = {}, onChunk) {
    try {
      const {
        model = 'gpt-3.5-turbo',
        maxTokens = 1000,
        temperature = 0.7
      } = options;

      logger.info(`OpenAI streaming request: ${model}, tokens: ${maxTokens}`);

      const stream = await this.client.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        stream: true
      });

      let fullResponse = '';
      let tokenCount = 0;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          tokenCount += this.estimateTokens(content);
          
          if (onChunk) {
            onChunk({
              chunk: content,
              fullResponse: fullResponse,
              tokenCount: tokenCount
            });
          }
        }
      }

      const result = {
        provider: this.provider,
        model: model,
        response: fullResponse,
        usage: {
          total_tokens: tokenCount
        },
        cost: this.calculateCost(model, tokenCount)
      };

      logger.info(`OpenAI streaming completed, estimated tokens: ${tokenCount}`);
      return result;

    } catch (error) {
      logger.error('OpenAI streaming request failed:', error);
      throw error;
    }
  }

  calculateCost(model, tokens) {
    const pricing = {
      'gpt-4': 0.00003,
      'gpt-4-turbo': 0.00001,
      'gpt-3.5-turbo': 0.000002,
      'gpt-3.5-turbo-16k': 0.000004
    };

    const costPerToken = pricing[model] || pricing['gpt-3.5-turbo'];
    return tokens * costPerToken;
  }

  estimateTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  async checkAvailability(model) {
    try {
      const models = await this.client.models.list();
      return models.data.some(m => m.id === model);
    } catch (error) {
      logger.error(`Failed to check availability for model ${model}:`, error);
      return false;
    }
  }

  async listAvailableModels() {
    try {
      const models = await this.client.models.list();
      return models.data
        .filter(model => model.id.includes('gpt'))
        .map(model => ({
          id: model.id,
          created: model.created,
          owned_by: model.owned_by
        }));
    } catch (error) {
      logger.error('Failed to list OpenAI models:', error);
      return [];
    }
  }

  getProviderName() {
    return this.provider;
  }

  getSupportedModels() {
    return [
      'gpt-4',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k'
    ];
  }
}

module.exports = OpenAIProvider;