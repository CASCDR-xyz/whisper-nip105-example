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
   * @returns {Promise<Buffer>} - The file content
   */
  async getFile(bucketName, fileName) {
    if (!bucketName || !fileName) {
      console.error("Missing required parameters: bucketName or fileName");
      return null;
    }
    
    const params = {
      Bucket: bucketName,
      Key: fileName
    };

    try {
      const command = new GetObjectCommand(params);
      
      // Add timeout and retry mechanism
      let attempts = 0;
      const maxAttempts = 3;
      let lastError = null;
      
      while (attempts < maxAttempts) {
        try {
          console.log(`Attempt ${attempts + 1} to get file ${fileName} from bucket ${bucketName}`);
          const data = await Promise.race([
            this.s3Client.send(command),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('S3 request timeout')), 5000)
            )
          ]);
          
          if (!data || !data.Body) {
            console.error("S3 response missing Body");
            return null;
          }
          
          return data.Body;  // The file content
        } catch (attemptError) {
          attempts++;
          lastError = attemptError;
          console.error(`Attempt ${attempts} failed:`, attemptError.message);
          
          if (attempts < maxAttempts) {
            // Exponential backoff
            const delay = Math.pow(2, attempts) * 200;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      // If we get here, all attempts failed
      console.error(`All ${maxAttempts} attempts to get file failed`, lastError);
      return null;
    } catch (error) {
      console.error("Error retrieving file:", error);
      return null;  // Return null instead of throwing to avoid crashing
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
