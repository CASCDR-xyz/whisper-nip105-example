# Use an Ubuntu base with Node.js pre-installed
FROM node:21-bullseye

# Set the working directory in the container
WORKDIR /app

# Copy your Node.js application files into the container
COPY . .

# Create temp directory inside /app with proper permissions
RUN mkdir -p /app/temp && chmod 777 /app/temp

# Install python3, pip3, git, ffmpeg, and necessary build tools using Ubuntu's apt package manager
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    git \
    ffmpeg \
    build-essential \
    libopenblas-dev

# Install Node.js dependencies
RUN npm install

# Expose the port on which your Node.js application will listen
EXPOSE 5001

# Clean up
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Increase Node.js memory limit for large file processing
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Production environment
ENV NODE_ENV=production

# Set reasonable timeouts for Node.js HTTP connections
ENV NODE_SOCKET_TIMEOUT=600000
ENV NODE_CONNECT_TIMEOUT=60000

# After creating the temp directory
RUN chmod 777 /app/temp

# Use non-root user for better security
USER node

# Define the default command to run your Node.js application
CMD ["node", "app.js"]