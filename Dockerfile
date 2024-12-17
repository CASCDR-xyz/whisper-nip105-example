# Use an Ubuntu base with Node.js pre-installed
FROM node:21-bullseye

# Set the working directory in the container
WORKDIR /app

# Copy your Node.js application files into the container
COPY . .

# Create temp directory inside /app
RUN mkdir -p /app/temp

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

# Expose the port on which your Node.js application will listen (e.g., 5001)
EXPOSE 5001

# Clean up
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# After creating the temp directory
RUN chmod 777 /app/temp

ENV NODE_ENV=production

# At the end of your Dockerfile
USER node

# Define the default command to run your Node.js application
CMD ["node", "app.js"]