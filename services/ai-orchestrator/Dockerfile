FROM node:18-alpine

# Install system dependencies for hardware detection
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    linux-headers \
    udev

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create directories for models and logs
RUN mkdir -p /app/models /app/logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Change ownership
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

CMD ["npm", "start"]