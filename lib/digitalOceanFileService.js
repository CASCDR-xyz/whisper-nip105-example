const DigitalOceanSpacesManager = require('./DigitalOceanSpacesManager');
require('dotenv').config();
const { Readable } = require('stream');
// Instantiate the DigitalOceanSpacesManager with your credentials and endpoint
const spacesManager = new DigitalOceanSpacesManager(
  'https://nyc3.digitaloceanspaces.com',  // Your DigitalOcean Spaces endpoint
  process.env.DO_ACCESS_KEY,  // The access key stored in your environment variables
  process.env.DO_SECRET_KEY  // The secret key stored in your environment variables
);
console.log('DigitalOceanSpacesManager instantiated');

/**
 * Uploads raw JSON data as a file to DigitalOcean Spaces
 * @param {string} bucketName - The name of the Space (bucket)
 * @param {string} fileName - The desired file name (e.g., "data.json")
 * @param {object} jsonData - The raw JSON data to be uploaded
 * @returns {Promise<string>} - The URL of the uploaded file
 */
async function uploadJsonData(bucketName, fileName, jsonData) {
  // Convert the raw JSON data to a string
  const jsonString = JSON.stringify(jsonData);

  try {
    // Use the uploadFile method from DigitalOceanSpacesManager
    const fileUrl = await spacesManager.uploadFile(bucketName, fileName, jsonString, 'application/json', 'nyc3.digitaloceanspaces.com');
    
    // Return the URL of the uploaded file
    return fileUrl;
  } catch (error) {
    console.error('Error uploading JSON data:', error);
    throw new Error('Failed to upload JSON data');
  }
}

/**
 * Fetches a file from DigitalOcean Spaces
 * @param {string} bucketName - The name of the Space (bucket)
 * @param {string} fileName - The name of the file to retrieve
 * @returns {Promise<object>} - The parsed JSON object from the fetched file
 */
async function fetchJsonData(bucketName, fileName) {
  try {
    // Fetch the file from DigitalOcean Spaces
    const fileStream = await spacesManager.getFile(bucketName, fileName);
    const fileBuffer = await streamToBuffer(fileStream);
    
    // Convert the buffer to a string and parse it as JSON only once
    const jsonData = JSON.parse(fileBuffer.toString());
    
    // Log for debugging
    console.log('Fetched content from DigitalOcean:');
    console.log(JSON.stringify(jsonData, null, 2));
    
    return jsonData;
  } catch (error) {
    console.error('Error fetching JSON data:', error);
    throw new Error('Failed to fetch JSON data');
  }
}


/**
 * Converts a readable stream to a buffer
 * @param {Readable} stream - The readable stream to convert
 * @returns {Promise<Buffer>} - A buffer containing the stream data
 */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

module.exports = { uploadJsonData, fetchJsonData };
