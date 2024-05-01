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

const { exec } = require('child_process');
const fs = require('fs');
const fs_promises = require('fs').promises;
const path = require('path');

const axios = require("axios");
const { sleep } = require("./lib/common");
const musicMetadata = require('music-metadata');

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

app.post("/:service", upload.single('audio'), async (req, res) => {
  const remoteUrl = req.body.remote_url;
  if (remoteUrl) {
    // Remote URL provided, download and process it
    try {
      const urlObj = new URL(remoteUrl);
      
      const isMp4InPath = urlObj.pathname.toLowerCase().endsWith(".mp4");
      const isMp4InMimeType = urlObj.searchParams.get("mime") === "video/mp4";
      const isMp4 = isMp4InPath || isMp4InMimeType;
      const isMp3OrMp4 = urlObj.pathname.toLowerCase().endsWith(".mp3") || isMp4;
      console.log(`urlObj:${urlObj}`)
      if (!isMp3OrMp4) {
        return res.status(400).send('Invalid file format. Only mp3 and mp4 are supported.');
      }

      // Download the remote file
      const downloadedFilePath = await downloadRemoteFile(remoteUrl);
      var mp3Path = downloadedFilePath;
      console.log(`downloadedFilePath:${downloadedFilePath}`)
      console.log(`isMp4:${isMp4}`)
      if(isMp4){
        mp3Path = downloadedFilePath.replace(".mp4", ".mp3");
        await extractAudioFromMp4(downloadedFilePath, mp3Path);
      }

      if(!validateAudioSize(mp3Path)){
        res.status(400).send("File is too large to transcribe. The limit is 25MB.")
      }

      // Determine the duration of the downloaded file
      const durationInSeconds = await getAudioDuration(mp3Path);

      // Process the downloaded file and generate an invoice
      const service = req.params.service;
      const invoice = await generateInvoice(service, durationInSeconds);

      // Save necessary data to the database
      const doc = await findJobRequestByPaymentHash(invoice.paymentHash);
      doc.requestData = { remote_url: remoteUrl };
      doc.requestData["filePath"] = mp3Path;
      doc.state = "NOT_PAID";
      await doc.save();

      logState(service, invoice.paymentHash, "REQUESTED");

      res.status(402).send(invoice);
    } catch (e) {
      console.log(e.toString().substring(0, 150));
      res.status(500).send(e);
    }
  }
  else{//file upload
    const metadata = await musicMetadata.parseFile(req.file.path);
    const durationInSeconds = metadata.format.duration;

    console.log("MP3 duration in seconds:", durationInSeconds);

    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }
    try {
      const service = req.params.service;
      const uploadedFilePath = req.file.path;
      const isMp4InPath = uploadedFilePath.toLowerCase().endsWith(".mp4");
      const isMp4 = isMp4InPath;
      const isMp3OrMp4 = uploadedFilePath.toLowerCase().endsWith(".mp3") || isMp4;
      console.log(`uploadedFilePath:${uploadedFilePath}`)
      if (!isMp3OrMp4) {
        return res.status(400).send('Invalid file format. Only mp3 and mp4 are supported.');
      }

      var mp3Path = uploadedFilePath;
      if(isMp4){
        mp3Path = uploadedFilePath.replace(".mp4", ".mp3");
        await extractAudioFromMp4(uploadedFilePath, mp3Path);
      }

      if(!validateAudioSize(mp3Path)){
        res.status(400).send("File is too large to transcribe. The limit is 25MB.")
      }

      const invoice = await generateInvoice(service,durationInSeconds);
      console.log("invoice:",invoice)
      const doc = await findJobRequestByPaymentHash(invoice.paymentHash);

      doc.requestData = req.body;
      doc.requestData["filePath"] = mp3Path;
      doc.state = "NOT_PAID";
      await doc.save();

      logState(service, invoice.paymentHash, "REQUESTED");

      res.status(402).send(invoice);
    } catch (e) {
      console.log(e.toString().substring(0, 150));
      res.status(500).send(e);
    }
  }
});

app.get("/:service/:payment_hash/get_result", async (req, res) => {
  console.log("get_result requested")
  try {
    const service = req.params.service;
    const paymentHash = req.params.payment_hash;
    const { isPaid, invoice } = await getIsInvoicePaid(paymentHash);

    logState(service, paymentHash, "POLL");
    if (isPaid != true) {
      res.status(402).send({ ...invoice, isPaid });
    } else {
      const doc = await findJobRequestByPaymentHash(paymentHash);

      switch (doc.state) {
        case "WORKING":
          logState(service, paymentHash, "WORKING");
          res.status(202).send({ state: doc.state });
          break;
        case "ERROR":
        case "DONE":
          logState(service, paymentHash, doc.state);
          res.status(200).send(doc.requestResponse);
          break;
        default:
          logState(service, paymentHash, "PAID");
          const data = doc.requestData;
          submitService(service, data)
            .then(async (response) => {
              doc.requestResponse = response;
              doc.state = "DONE";
              await doc.save();
            })
            .catch(async (e) => {
              doc.requestResponse = e;
              doc.state = "ERROR";
              await doc.save();
            });

          doc.state = "WORKING";
          await sleep(1000)
          await doc.save();
          res.status(202).send({ state: doc.state });
      }
    }
  } catch (e) {
    console.log(e.toString().substring(0, 300));
    res.status(500).send(e);
  }
});

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
