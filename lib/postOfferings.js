const { getPublicKey, relayInit } = require("nostr-tools");
const { getBitcoinPrice } = require('./bitcoinPrice')
const { createOfferingNote } = require("./nostr");
const path = require('path');
const fs = require('fs');
const {
  WHSPR_SCHEMA,
  WHSPR_REMOTE_SCHEMA,
  WHSPR_RESULT_SCHEMA,
} = require("../const/serviceSchema.js");
const {usd_to_millisats} = require('./common')

async function postOfferings() {
  try{
    const sk = process.env.NOSTR_SK;
    const pk = getPublicKey(sk);

    const relay = relayInit(process.env.NOSTR_RELAY);
    console.log(sk);
    console.log(pk)
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
  catch(error){
    console.log("postOfferings error:", error)
  }
  
}

function houseKeeping() {
  const tempDir = path.join(__dirname, '..', 'temp');
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

module.exports = { postOfferings, houseKeeping };