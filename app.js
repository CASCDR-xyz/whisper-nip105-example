// external dependencies
const express = require('express');
const WebSocket = require("ws");
const cors = require('cors');
const bodyParser = require("body-parser");
const mongoose = require('mongoose');

// middleware
const logger = require('./middleware/logger');

// routes
const serviceRoutes = require('./routes/service');

// lib
const { postOfferings, houseKeeping } = require('./lib/postOfferings')

// used for testing
/*
const { JobRequest } = require('./models/jobRequest')
const { 
  validatePreimage, 
  validateCascdrUserEligibility 
} = require('./lib/authChecks');
const util = require('util');
*/

// --------------------- MONGOOSE -----------------------------

const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });

const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB!");
});

// --------------------- APP SETUP -----------------------------

const app = express();
require("dotenv").config();
global.WebSocket = WebSocket;


app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.set('trust proxy', true); // trust first proxy

// Request Logging
app.use(logger);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow requests from any origin (*)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

const port = process.env.PORT || 5004;

// const writeFile = util.promisify(fs.writeFile);

// ------------------- MOUNT ENDPOINT ROUTES -----------------------------

app.use('/', serviceRoutes);

// -------------------- POST OFFERINGS ------------------------------------


async function run_periodic_tasks(){
  postOfferings();
  houseKeeping();
}


postOfferings();
houseKeeping();
setInterval(run_periodic_tasks, 300000);

// Start the server
app.listen(port, () => {
  console.log(`Whisper Server is listening on port ${port}`);
});
