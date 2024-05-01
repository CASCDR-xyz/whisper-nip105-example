const { usd_to_millisats } = require("./common");
const { getBitcoinPrice } = require("./bitcoinPrice");
const { deleteFile } = require("./fileManagement");
const axios  = require('axios');
const { exec } = require('child_process');
const fs = require('fs');

const {
  WHSPR_SCHEMA
} = require('../const/serviceSchema');

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

module.exports = { submitService, getServicePrice };