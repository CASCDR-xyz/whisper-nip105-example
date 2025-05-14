const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

class DigitalOceanSpacesManager {
  /**
   * Constructor for DigitalOceanSpacesManager
   * @param {string} spacesEndpoint - The endpoint of the DigitalOcean Space (e.g., "nyc3.digitaloceanspaces.com").
   * @param {string} accessKeyId - The access key for DigitalOcean Spaces.
   * @param {string} secretAccessKey - The secret key for DigitalOcean Spaces.
   */
  constructor(spacesEndpoint, accessKeyId, secretAccessKey) {
    this.s3Client = new S3Client({
      endpoint: spacesEndpoint,  // Pass the endpoint directly as a string
      region: "us-east-1",  // You may need to adjust the region for your DigitalOcean Space
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
  }

  /**
   * Upload a file to a specified Space
   * @param {string} bucketName - The Space name
   * @param {string} fileName - The file name to save
   * @param {Buffer|string} fileContent - The file content
   * @param {string} contentType - The MIME type of the file
   * @param {string} spacesEndpoint - The endpoint of the DigitalOcean Space
   * example: "nyc3.digitaloceanspaces.com"
   * @returns {Promise<string>} - The public URL of the uploaded file
   */
  async uploadFile(bucketName, fileName, fileContent, contentType, spacesEndpoint) {
    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: fileContent,
      ContentType: contentType,
      ACL: "public-read"
    };

    try {
      const command = new PutObjectCommand(params);
      await this.s3Client.send(command);
      return `https://${bucketName}.${spacesEndpoint}/${fileName}`;
    } catch (error) {
      console.error("Error uploading file:", error);
      throw new Error("Failed to upload file to DigitalOcean Spaces.");
    }
  }

  /**
   * Get a file from a specified Space
   * @param {string} bucketName - The Space name
   * @param {string} fileName - The file name to retrieve
   * @returns {Promise<Buffer|null>} - The file content or null if file doesn't exist
   */
  async getFile(bucketName, fileName) {
    const params = {
      Bucket: bucketName,
      Key: fileName
    };

    try {
      const command = new GetObjectCommand(params);
      const data = await this.s3Client.send(command);
      return data.Body;  // The file content
    } catch (error) {
      // Check if this is a NoSuchKey error (file doesn't exist)
      if (error.name === 'NoSuchKey' || 
          (error.$metadata && error.$metadata.httpStatusCode === 404) || 
          error.Code === 'NoSuchKey') {
        console.log(`File ${fileName} not found in bucket ${bucketName} - this is normal for new content`);
        return null;  // Return null instead of throwing
      }
      // For other errors, log and rethrow
      console.error("Error retrieving file:", error);
      throw new Error("Failed to get file from DigitalOcean Spaces.");
    }
  }

  /**
   * Delete a file from a specified Space
   * @param {string} bucketName - The Space name
   * @param {string} fileName - The file name to delete
   * @returns {Promise<void>}
   */
  async deleteFile(bucketName, fileName) {
    const params = {
      Bucket: bucketName,
      Key: fileName
    };

    try {
      const command = new DeleteObjectCommand(params);
      await this.s3Client.send(command);
    } catch (error) {
      console.error("Error deleting file:", error);
      throw new Error("Failed to delete file from DigitalOcean Spaces.");
    }
  }
}

module.exports = DigitalOceanSpacesManager;
