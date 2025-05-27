# This dockerfile specifies the environment the production
# code will be run in, along with what files are needed
# for production

# Use an official Node.js runtime as the base image
FROM node:lts-bookworm-slim

# Use a non-interactive frontend for debconf
ENV DEBIAN_FRONTEND=noninteractive

# Install Git
RUN apt-get update && \
    apt-get install -y git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create user for security
RUN useradd -m seedgpt_user

# Copy package files and dist directory
COPY dist/src/ ./
COPY package*.json ./
COPY agent-config.yaml ./
COPY tasks.yaml ./

# Create necessary directories
RUN mkdir -p logs memory summaries workspace && \
    chown -R seedgpt_user:seedgpt_user /app

# Switch to non-root user
USER seedgpt_user

# Install production dependencies
RUN npm ci --omit=dev

# Configure Git for the user (required for git operations)
RUN git config --global user.email "agent.seedgpt@gmail.com" && \
    git config --global user.name "SeedGPT" && \
    git config --global init.defaultBranch main

# Command to run the application
CMD ["npm", "start"]
