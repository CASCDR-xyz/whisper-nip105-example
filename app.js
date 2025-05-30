const express = require('express');
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const mongoose = require('mongoose');
const logger = require('./middleware/logger');
const serviceRoutes = require('./routes/service');
const { postOfferings, houseKeeping } = require('./lib/postOfferings');
const jobManager = require('./lib/jobManager');

require("dotenv").config();
global.WebSocket = WebSocket;

const app = express();

const allowedOrigins = ['http://localhost:3000', 'https://cascdr.xyz'];

// CORS setup first
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.header('X-Content-Type-Options', 'nosniff');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }
  next();
});

// Basic middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', true);
app.use(logger);

// MongoDB setup
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Routes
app.use('/', serviceRoutes);

// Periodic tasks
async function run_periodic_tasks() {
  houseKeeping();
}

houseKeeping();
setInterval(run_periodic_tasks, 300000);

// Start server
const port = process.env.PORT || 5004;
const startServer = async () => {
  try {
    await connectDB();
    const server = app.listen(port, () => {
      console.log(`Whisper Server running on port ${port}`);
    });

    ['SIGTERM', 'SIGINT'].forEach(signal => {
      process.on(signal, () => {
        console.log('Shutting down...');
        server.close(async () => {
          await mongoose.connection.close();
          process.exit(0);
        });
      });
    });

  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;