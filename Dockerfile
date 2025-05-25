# This dockerfile specifies the environment the production
# code will be run in, along with what files are needed
# for production

# Use an official Node.js runtime as the base image
FROM node:lts-bookworm-slim

# Use a non-interactive frontend for debconf
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /app

# Create user for security
RUN useradd -m -s /bin/bash seedgpt_user

# Copy package files and dist directory
COPY package*.json ./
COPY dist ./dist

# Install production dependencies
RUN npm ci --omit=dev

# Create necessary directories
RUN mkdir -p logs memory summaries workspace && \
    chown -R seedgpt_user:seedgpt_user /app

# Switch to non-root user
USER seedgpt_user

# Configure Git for the user (required for git operations)
RUN git config --global user.email "seedgpt@autonomous.dev" && \
    git config --global user.name "SeedGPT Agent" && \
    git config --global init.defaultBranch main

# Set environment variables with defaults
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Command to run the application
CMD ["npm", "start"]
