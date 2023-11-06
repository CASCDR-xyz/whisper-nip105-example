const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const fs_promises = require('fs').promises;
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
  WHSPR_REMOTE_SCHEMA,
  WHSPR_RESULT_SCHEMA,
  OFFERING_KIND,
} = require("./lib/defines.js");
const { sleep } = require("./lib/helpers");
const musicMetadata = require('music-metadata');
const runWhisperLocally = false;

global.WebSocket = WebSocket;

// Initialize app
const app = express();
const port = process.env.PORT || 5004;

const mongoose = require("mongoose");

// Promisify necessary functions
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
const writeFile = util.promisify(fs.writeFile);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));



const { v4: uuidv4 } = require('uuid');

//File Management Helpers://

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Create a predictable directory structure based on today's date
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const year = today.getFullYear();
        
        const dir = path.join(__dirname, "temp");
        const fileName = `downloaded_file_${Date.now()}.mp3`;

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



async function isMp4File(filePath) {
  const fileExtension = path.extname(filePath);
  return fileExtension === '.mp4';
}

async function extractAudioFromMp4(inputFilePath, outputFilePath) {
  const ffmpeg = require("fluent-ffmpeg");
  console.log(`Extracting video from: ${inputFilePath} and moving it to ${outputFilePath}`)
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputFilePath)
      .audioCodec('libmp3lame')
      .toFormat('mp3')
      .on('end', () => {
        deleteFile(inputFilePath);
        resolve();
      })
      .on('error', (err) => {
        deleteFile(inputFilePath);
        reject(err);
      })
      .save(outputFilePath);
  });
}

async function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const durationInSeconds = metadata.format.duration;
        resolve(durationInSeconds);
      }
    });
  });
}



//END File Management Helpers//

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

async function generateInvoice(service,durationInSeconds) {
  const msats = await getServicePrice(service,durationInSeconds);
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

async function getServicePrice(service,durationInSeconds) {
  console.log("getServicePrice service:",service)
  const bitcoinPrice = await getBitcoinPrice(); 
  console.log("bitcoinPrice:",bitcoinPrice)
  const units_count = durationInSeconds / 60.0;//assuming MINS for now. Would need to make this a function to support more units
  const fixedUsd = parseFloat(process.env.WHSPR_FIXED_USD);
  const variableUsd = parseFloat(process.env.WHSPR_VARIABLE_USD);
  const totalUsd = fixedUsd + (units_count * variableUsd);
  switch (service) {
    case "WHSPR":
      return usd_to_millisats(totalUsd,bitcoinPrice);
    default:
      return usd_to_millisats(totalUsd,bitcoinPrice);
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

async function callWhisper(data, runWhisperLocally) {
    return new Promise(async (resolve, reject) => {
        const audioFilePath = data.filePath;

        if (!audioFilePath) {
            reject(new Error('Audio file path not found.'));
            return;
        }

        if (runWhisperLocally) {
            // Call the Python script with the audio file path
            exec(`python3 run_whisper.py ${audioFilePath}`, (error, stdout, stderr) => {
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
        } else {////
            try {
              console.log(`Calling whisper...`)
                const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', 
                    {
                        model: "whisper-1",
                        file: fs.createReadStream(audioFilePath)
                    }, 
                    {
                        headers: {
                            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                            "Content-Type": "multipart/form-data"
                        }
                    }
                );
                console.log(`Got response from Whisper:`,response.data)
                resolve(response.data);

                deleteFile(audioFilePath);

            } catch (error) {
              console.log(`Got error from Whisper:`,error)
                reject(new Error(`Failed to transcribe audio via OpenAI API. Error: ${error.message}`));
            }
        }
    });
}

async function deleteFile(path){
  // Delete the file after processing and saving transcription
  try {
      fs.unlinkSync(path);
      console.log(`Successfully deleted: ${path}`);
  } catch (err) {
      console.error(`Error deleting file ${path}:`, err);
  }
}


app.get('/', (req, res) => {
  res.status(200).send("Send your POST request to /WHSPR for transcriptions ")
});


// Function to download a remote file and return its local path
async function downloadRemoteFile(remoteUrl) {
  const tempDir = path.join(__dirname, "/app/temp");
  const urlObj = new URL(remoteUrl);
  const isMp4InPath = urlObj.pathname.toLowerCase().endsWith(".mp4");
  const isMp4InMimeType = urlObj.searchParams.get("mime") === "video/mp4";
  const isMp4 = isMp4InPath || isMp4InMimeType;
  const isMp3OrMp4 = urlObj.pathname.toLowerCase().endsWith(".mp3") || isMp4;
  //console.log(`isMp4:${isMp4},isMp4InMimeType:${isMp4InMimeType},isMp4InPath:${isMp4InPath}`)
  if(!isMp3OrMp4){
    throw new Error(`File is not mp3 or mp4`);
  }
  const fileName = `downloaded_file_${Date.now() + (isMp4 ? '.mp4' : '.mp3')}`;

  try {
    // Create the temp directory if it doesn't exist
    await fs_promises.mkdir(tempDir, { recursive: true });

    const filePath = path.join(tempDir, fileName);

    // Download the remote file as a stream and save it locally
    const response = await axios.get(remoteUrl, { responseType: "stream" });
    const writer = require('fs').createWriteStream(filePath); // Use non-promise method here

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    return filePath;
  } catch (error) {
    throw new Error(`Failed to download remote file: ${error.message}`);
  }
}

// Function to get the audio duration
async function getAudioDuration(audioFilePath) {
  const ffmpeg = require("fluent-ffmpeg");

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioFilePath)
      .ffprobe((err, data) => {
        if (err) {
          reject(err);
        } else {
          const durationInSeconds = data.format.duration;
          resolve(durationInSeconds);
        }
      });
  });
}

async function validateAudioSize(audioFilePath){
    const limit = 25;//MB
    fs.stat(audioFilePath, (err, stats) => {
    if (err) {
      console.error('Error reading file information:', err);
      return false;
    } else {
      // File size in bytes
      const fileSizeBytes = stats.size;

      // Convert bytes to kilobytes (KB) or megabytes (MB) for more readable output
      const fileSizeKB = fileSizeBytes / 1024;
      const fileSizeMB = fileSizeKB / 1024;

      console.log(`File size: ${fileSizeBytes} bytes`);
      console.log(`File size: ${fileSizeKB} KB`);
      console.log(`File size: ${fileSizeMB} MB`);
      return (fileSizeMB < limit);
    }
  });
}

function houseKeeping() {
  const tempDir = path.join(__dirname, "temp");
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  fs.readdir(tempDir, (err, files) => {
    if (err) {
      console.error('Error reading temp directory:', err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(tempDir, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) {
          console.error(`Error reading file information for ${filePath}:`, statErr);
          return;
        }

        const fileModifiedDate = new Date(stats.mtime);

        if (fileModifiedDate < oneDayAgo) {
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error(`Error deleting file ${filePath}:`, unlinkErr);
            } else {
              console.log(`Deleted file: ${filePath}`);
            }
          });
        }
      });
    });
  });
}

// --------------------- NOSTR -----------------------------
function createOfferingNote(
  pk,
  sk,
  service,
  cost_fixed,
  cost_variable,
  cost_units,
  endpoint,
  status,
  inputSchema,
  outputSchema,
  description
) {
  const now = Math.floor(Date.now() / 1000);
  console.log('inputSchema:',inputSchema)
  console.log('outputSchema:', outputSchema)

  const content = {
    endpoint, // string
    status, // UP/DOWN/CLOSED
    cost_fixed, // number
    cost_variable,
    cost_units,
    inputSchema, // Json Schema
    outputSchema, // Json Schema
    description, // string / NULL
  };

  let offeringEvent = {
    kind: OFFERING_KIND,
    pubkey: pk,
    created_at: now,
    tags: [
      ["s", service],
      ["d", service],
    ],
    content: JSON.stringify(content),
  };
  offeringEvent.id = getEventHash(offeringEvent);
  offeringEvent.sig = getSignature(offeringEvent, sk);

  console.log(`offeringEvent:`,offeringEvent)

  return offeringEvent;
}

// Post Offerings
async function postOfferings() {
  const sk = process.env.NOSTR_SK;
  const pk = getPublicKey(sk);

  const relay = relayInit(process.env.NOSTR_RELAY);
  relay.on("connect", () => {
    console.log(`connected to ${relay.url}`);
  });
  relay.on("error", (e) => {
    console.log(`failed to connect to ${relay.url}: ${e}`);
  });
  await relay.connect();

  const bitcoinPrice = await getBitcoinPrice(); 
  const fixed_msats = await usd_to_millisats(process.env.WHSPR_FIXED_USD,bitcoinPrice);
  const variable_msats = await usd_to_millisats(process.env.WHSPR_VARIABLE_USD,bitcoinPrice);

  const whisperOffering = createOfferingNote(
    pk,
    sk,
    "https://api.openai.com/v1/audio/transcriptions",
    fixed_msats,
    variable_msats,
    process.env.WHSPR_COST_UNITS,
    process.env.ENDPOINT + "/" + "WHSPR",
    "UP",
    WHSPR_SCHEMA,
    WHSPR_RESULT_SCHEMA,
    "Get access to Whisper transcriptions here! Upload your file directly to the endpoint and it will process & provide an invoice"
  );

  await relay.publish(whisperOffering);
  console.log(`Published Whisper Offering: ${whisperOffering.id}`);

  const whisperOffering2 = createOfferingNote(
    pk,
    sk,
    "https://api.openai.com/v1/audio/transcriptions",
    fixed_msats,
    variable_msats,
    process.env.WHSPR_COST_UNITS,
    process.env.ENDPOINT + "/" + "WHSPR",
    "UP",
    WHSPR_REMOTE_SCHEMA,
    WHSPR_RESULT_SCHEMA,
    "Get access to Whisper transcriptions here! Provide a URL to an mp3 or mp4 file and the endpoint will process & provide an invoice."
  );

  await relay.publish(whisperOffering2);
  console.log(`Published Whisper REMOTE Offering: ${whisperOffering2.id}`);

  relay.close();
}

async function run_periodic_tasks(){
  postOfferings();
  houseKeeping();
}


postOfferings();
houseKeeping();
setInterval(run_periodic_tasks, 300000);

// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
