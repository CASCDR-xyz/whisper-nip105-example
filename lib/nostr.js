const {
  getEventHash,
  getSignature,
} = require("nostr-tools");
const {
  OFFERING_KIND,
} = require('../const/serviceSchema');
const crypto = require('crypto')

// Function to return the SHA256 hash of a given string
function sha256Hash(obj) {
  // Create a SHA256 hash
  const hash = crypto.createHash('sha256');

  // Update the hash with the string
  hash.update(JSON.stringify(obj));

  // Return the hash digest in hexadecimal format
  return hash.digest('hex');
}

function createOfferingNote(
  pk,
  sk,
  service,
  cost,
  endpoint,
  status,
  inputSchema,
  outputSchema,
  description
) {
  const now = Math.floor(Date.now() / 1000);

  console.log(typeof(outputSchema))
  const outputHash = sha256Hash(outputSchema);
  console.log(`outputHash:${outputHash}`)

  const inputHash = sha256Hash(inputSchema);
  console.log(`inputHash:${inputHash}`)

  const content = {
    endpoint, // string
    status, // UP/DOWN/CLOSED
    cost, // number
    inputSchema, // Json Schema
    outputSchema, // Json Schema
    description, // string / NULL
    inputHash,
    outputHash
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

  return offeringEvent;
}

module.exports = {
    createOfferingNote,
};