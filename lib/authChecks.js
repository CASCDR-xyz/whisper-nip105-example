const crypto = require('crypto');
const axios = require('axios');

require("dotenv").config();

/**
 * Checks if the SHA256 hash of the preimage matches the payment hash from the BOLT11 invoice.
 * 
 * @param {string} preimageHex The preimage as a hexadecimal string.
 * @param {string} paymentHashHex The payment hash from the BOLT11 invoice as a hexadecimal string.
 * @return {boolean} True if the preimage hashes to the payment hash, false otherwise.
 */
function validatePreimage(preimageHex, paymentHashHex) {
    // Convert the preimage hex string to a Buffer
    const preimageBuffer = Buffer.from(preimageHex, 'hex');

    // Hash the preimage using SHA256
    const hash = crypto.createHash('sha256');
    hash.update(preimageBuffer);
    const computedHashHex = hash.digest('hex');

    // Compare the computed hash to the payment hash from the invoice
    const result = computedHashHex === paymentHashHex;
    console.log("preImage:",preimageHex,"paymentHash:",paymentHashHex,"result:",result)
    return result;
}

async function validateCascdrUserEligibility(token,reqIPAddress,requestedService, endpointRequested) {
  console.log("validate eligibility args (token,reqIPAddress,requestedService):",token,reqIPAddress,requestedService)
  let passedToken = (token) ? (token) : ("no-token")

  const route = process.env.CASCDR_AUTH_ELIGIBILITY_CHECK_ROUTE;
  console.log("route for auth eligibility check:", route)
  try {
      const response = await axios.post(route, {
        "reqIpAddress":reqIPAddress,
        "requestedService":requestedService,
        "endpointRequested":endpointRequested
      }, { // Sending an empty object as the body, headers remain the same
        headers: {
            Authorization: `Bearer ${passedToken}` // Authorization header with the token
        }
    });
      // Check if the response matches the required conditions
      console.log("validateCascdrUserEligibility result:", response.data)
      return response.data.checks;
  } catch (error) {
      console.error(error);
      return false;
  }
}


module.exports = {
    validatePreimage,
    validateCascdrUserEligibility
  };