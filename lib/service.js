const { usd_to_millisats } = require("./common");
const { getBitcoinPrice } = require("./bitcoinPrice");
const { deleteFile } = require("./fileManagement");
const axios  = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const fsPromises = require('fs').promises;


const { createClient } = require("@deepgram/sdk");
require("dotenv").config();

const {
  WHSPR_SCHEMA
} = require('../const/serviceSchema');

const transcribeLocalFile = async (filePath) => {
  console.log("Attempting to transcribe local file:", filePath);

  if (!filePath) {
    console.error("No file path provided for transcription");
    throw new Error("No file path provided for transcription");
  }

  try {
    // STEP 1: Create a Deepgram client using the API key
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

    // STEP 2: Read the file
    const audioBuffer = await fsPromises.readFile(filePath);

    // STEP 3: Call the transcribeFile method with the audio payload and options
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      // STEP 4: Configure Deepgram options for audio analysis
      {
        model: "nova-2",
        smart_format: true,
      }
    );

    if (error) {
      console.error("Deepgram transcription error:", error);
      throw error;
    }

    // STEP 5: Return the results
    console.log("Transcription successful");
    return result;
  } catch (error) {
    console.error("Error in transcribeLocalFile:", error);
    throw error;
  }
};


const transcribeUrl = async (url) => {
  console.log("Attempting to transcribe URL:", url);

  if (!url) {
    console.error("No URL provided for transcription");
    throw new Error("No URL provided for transcription");
  }

  try {
    // STEP 1: Create a Deepgram client using the API key
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    
    // STEP 2: Call the transcribeUrl method with the audio payload and options
    const { result, error } = await deepgram.listen.prerecorded.transcribeUrl(
      {
        url: url,
      },
      // STEP 3: Configure Deepgram options for audio analysis
      {
        model: "nova-2",
        smart_format: true,
      }
    );

    if (error) {
      console.error("Deepgram transcription error:", error);
      throw error;
    }

    // STEP 4: Print the results
    console.log("Transcription successful, result:", result);
    return result;
  } catch (error) {
    console.error("Error in transcribeUrl:", error);
    throw error;
  }
};

// don't need this for now but its here in case
function sanitizeData(data, schema) {
  if (schema.type === "object" && schema.properties) {
      const newObj = {};
      for (const key in schema.properties) {
          if (data.hasOwnProperty(key)) {
              newObj[key] = sanitizeData(data[key], schema.properties[key]);
          }
      }
      return newObj;
  } else if (schema.type === "array" && schema.items) {
      if (Array.isArray(data)) {
          return data.map(item => sanitizeData(item, schema.items));
      }
      return [];
  } else {
      return data;
  }
}

async function getServicePrice(service, durationInSeconds) {
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

function submitService(service, data) {
  switch (service) {
    case "WHSPR":
      const whisperLocal = false;
      return callWhisper(data, whisperLocal);
  }
}

async function callWhisper(data, runWhisperLocally) {
  return new Promise(async (resolve, reject) => {
      const audioFilePath = data.filePath;
      console.log(`callWhisper data:${data}`)
      console.log(`audioFilePath:${audioFilePath}`)
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
      } else {
          try {
            console.log(`Calling whisper...`)
            const result = await transcribeLocalFile(audioFilePath);
            console.log("result:")
            console.dir(result, { depth: null })
            console.log(`Got response from Whisper:`,result.results)
            resolve(result.results);

            deleteFile(audioFilePath);

          } catch (error) {
            console.log(`Got error from Whisper:`,error)
              reject(new Error(`Failed to transcribe audio via OpenAI API. Error: ${error.message}`));
          }
      }
  });
}

module.exports = { submitService, getServicePrice };