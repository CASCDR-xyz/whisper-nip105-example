const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const fs_promises = require('fs').promises;
const path = require('path');
const ffmpeg = require("fluent-ffmpeg");

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

async function deleteFile(path){
    // Delete the file after processing and saving transcription
    try {
        fs.unlinkSync(path);
        console.log(`Successfully deleted: ${path}`);
    } catch (err) {
        console.error(`Error deleting file ${path}:`, err);
    }
}

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

// Function to get the audio duration
async function getAudioDuration(audioFilePath) {
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

module.exports =  { getDuration, 
                    upload, 
                    isMp4File, 
                    extractAudioFromMp4, 
                    deleteFile,
                    downloadRemoteFile,
                    validateAudioSize,
                    getAudioDuration
                };