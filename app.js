const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const util = require('util');
const path = require('path');
require('dotenv').config();

const WebSocket = require("ws");
const cors = require('cors');
const axios = require("axios");
const bolt11 = require("bolt11");
const bodyParser = require("body-parser");
const { getBitcoinPrice } = require('./lib/bitcoinPrice');
const {
  relayInit,
  getPublicKey,
  getEventHash,
  getSignature,
} = require("nostr-tools");
const {
  WHSPR_SCHEMA,
  WHSPR_RESULT_SCHEMA,
  OFFERING_KIND,
} = require("./lib/defines.js");
const { sleep } = require("./lib/helpers");

global.WebSocket = WebSocket;

// Initialize app
const app = express();
const port = process.env.PORT || 6969;

const mongoose = require("mongoose");

// Promisify necessary functions
app.use(cors());
const writeFile = util.promisify(fs.writeFile);


const { v4: uuidv4 } = require('uuid');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Create a predictable directory structure based on today's date
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const year = today.getFullYear();
        
        const dir = `uploads/${year}/${month}/${day}/`;

        // Ensure the directory exists, if not, create it
        fs.promises.mkdir(dir, { recursive: true }).then(() => {
            cb(null, dir);
        }).catch(cb);
    },
    filename: function (req, file, cb) {
        // Use UUID for unique filenames
        cb(null, `${file.fieldname}-${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

// --------------------- MONGOOSE -----------------------------

const JobRequestSchema = new mongoose.Schema({
  invoice: Object,
  paymentHash: String,
  verifyURL: String,
  status: String,
  result: String,
  price: Number,
  requestData: Object,
  requestResponse: Object,
  service: String,
  state: String,
});

const JobRequest = mongoose.model("JobRequest", JobRequestSchema);

const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });

const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB!");
});

// --------------------- HELPERS -----------------------------

function logState(service, paymentHash, state) {
  console.log(`${paymentHash.substring(0, 5)} - ${service}: ${state}`);
}

function getLNURL() {
  const parts = process.env.LN_ADDRESS.split("@");
  if (parts.length !== 2) {
    throw new Error(`Invalid lnAddress: ${process.env.LN_ADDRESS}`);
  }
  const username = parts[0];
  const domain = parts[1];
  return `https://${domain}/.well-known/lnurlp/${username}`;
}

async function createNewJobDocument(service, invoice, paymentHash, price) {
  const newDocument = new JobRequest({
    invoice,
    paymentHash,
    verifyURL: invoice.verify,
    price,
    service,
    status: "UNPAID",
    result: null,
    requestData: null,
  });

  // Save the document to the collection
  await newDocument.save();
}

async function findJobRequestByPaymentHash(paymentHash) {
  const jobRequest = await JobRequest.findOne({ paymentHash }).exec();
  if (!jobRequest) {
    throw new Error("No Doc found");
  }

  return jobRequest;
}

async function getIsInvoicePaid(paymentHash) {
  const doc = await findJobRequestByPaymentHash(paymentHash);

  const invoice = doc.invoice;

  if (doc.status == "PAID") {
    return { isPaid: true, invoice };
  }

  const response = await axios.get(doc.verifyURL, {
    headers: {
      Accept: "application/json",
    },
  });

  const isPaid = response.data.settled == true;

  doc.status = isPaid ? "PAID" : doc.status;
  await doc.save();

  return { isPaid, invoice };
}

async function getPaymentHash(invoice) {
  const decodedInvoice = await bolt11.decode(invoice);
  const paymentHashTag = decodedInvoice.tags.find(
    (tag) => tag.tagName === "payment_hash"
  ).data;
  return paymentHashTag;
}

async function generateInvoice(service) {
  const msats = await getServicePrice(service);
  console.log("msats:",msats)
  const lnurlResponse = await axios.get(getLNURL(), {
    headers: {
      Accept: "application/json",
    },
  });

  const lnAddress = lnurlResponse.data;

  if (msats > lnAddress.maxSendable || msats < lnAddress.minSendable) {
    throw new Error(
      `${msats} msats not in sendable range of ${lnAddress.minSendable} - ${lnAddress.maxSendable}`
    );
  }

  const expiration = new Date(Date.now() + 3600 * 1000); // One hour from now
  const url = `${lnAddress.callback}?amount=${msats}&expiry=${Math.floor(
    expiration.getTime() / 1000
  )}`;

  const invoiceResponse = await axios.get(url);
  const invoiceData = invoiceResponse.data;

  const paymentHash = await getPaymentHash(invoiceData.pr);
  const successAction = getSuccessAction(service, paymentHash);

  const invoice = { ...invoiceData, successAction, paymentHash };

  await createNewJobDocument(service, invoice, paymentHash, msats);

  return invoice;
}

function usd_to_millisats(servicePriceUSD, bitcoinPrice) {
  console.log("usd_to_millisats servicePriceUSD:", servicePriceUSD)
  console.log("bitcoinPrice:", bitcoinPrice)
  const profitMarginFactor = 1.0 + process.env.PROFIT_MARGIN_PCT / 100.0;
  const rawValue = (servicePriceUSD * 100000000000 * profitMarginFactor) / bitcoinPrice;
  const roundedValue = Math.round(rawValue / 1000) * 1000; // Round to the nearest multiple of 1000
  return roundedValue;
}

async function getServicePrice(service) {
  console.log("getServicePrice service:",service)
  const bitcoinPrice = await getBitcoinPrice(); 
  console.log("bitcoinPrice:",bitcoinPrice)
  switch (service) {
    case "WHSPR":
      return usd_to_millisats(process.env.WHSPR_USD,bitcoinPrice);
    default:
      return usd_to_millisats(process.env.WHSPR_USD,bitcoinPrice);
  }
}

function getSuccessAction(service, paymentHash) {
  return {
    tag: "url",
    url: `${process.env.ENDPOINT}/${service}/${paymentHash}/get_result`,
    description: "Open to get the confirmation code for your purchase.",
  };
}


app.post("/:service", upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }
  try {
    const service = req.params.service;
    const uploadedFilePath = req.file.path;
    const invoice = await generateInvoice(service);
    console.log("invoice:",invoice)
    const doc = await findJobRequestByPaymentHash(invoice.paymentHash);

    doc.requestData = req.body;
    doc.requestData["filePath"] = uploadedFilePath;
    doc.state = "NOT_PAID";
    await doc.save();

    logState(service, invoice.paymentHash, "REQUESTED");

    res.status(402).send(invoice);
  } catch (e) {
    console.log(e.toString().substring(0, 150));
    res.status(500).send(e);
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

app.get("/:service/:payment_hash/check_payment", async (req, res) => {
  try {
    const paymentHash = req.params.payment_hash;
    const { isPaid, invoice } = await getIsInvoicePaid(paymentHash);

    res.status(200).json({ invoice, isPaid });
  } catch (e) {
    console.log(e.toString().substring(0, 50));
    res.status(500).send(e);
  }
});

function submitService(service, data) {
  switch (service) {
    case "WHSPR":
      return callWhisper(data);
  }
}

async function callWhisper(data) {
    return new Promise((resolve, reject) => {
        const audioFilePath = data.filePath;

        if (!audioFilePath) {
            reject(new Error('Audio file path not found.'));
            return;
        }

        // Call the Python script with the audio file path
        exec(`python run_whisper.py ${audioFilePath}`, (error, stdout, stderr) => {
            if (error) {
                console.error('stderr', stderr);
                reject(new Error('Failed to transcribe audio.'));
                return;
            }

            // Delete the file after processing and saving transcription
            try {
                fs.unlinkSync(audioFilePath);
                console.log(`Successfully deleted: ${audioFilePath}`);
            } catch (err) {
                console.error(`Error deleting file ${audioFilePath}:`, err);
            }
            
            // Return the transcription response
            resolve(stdout);
        });
    });
}




// Handle audio file upload and transcription
app.post('/transcribe', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const audioFilePath = req.file.path; // This is your audio file path

    // Call the Python script with the audio file path
    exec(`python run_whisper.py ${audioFilePath}`, (error, stdout, stderr) => {
        if (error) {
            console.error('stderr', stderr);
            return res.status(500).send('Internal Server Error');
        }
        // Send the transcription response
        res.send(stdout);
    });
});

// Function to get the audio duration
function getAudioDuration(audioBuffer) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioBuffer)
      .on('end', (stdout, stderr) => {
        // Parse the duration from the ffmpeg output
        const durationMatch = stderr.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (durationMatch && durationMatch.length >= 2) {
          const durationString = durationMatch[1];
          const [hours, minutes, seconds] = durationString.split(':').map(parseFloat);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          resolve(totalSeconds);
        } else {
          reject('Unable to determine audio duration');
        }
      })
      .on('error', reject)
      .run();
  });
}

// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
