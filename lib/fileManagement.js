const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const fs_promises = require('fs').promises;
const path = require('path');
const ffmpeg = require("fluent-ffmpeg");
const TEMP_DIR = path.join(__dirname, '..', 'temp');


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
      // Ensure the directory exists
      fs.promises.mkdir(TEMP_DIR, { recursive: true })
          .then(() => cb(null, TEMP_DIR))
          .catch(cb);
  },
  filename: function (req, file, cb) {
      // Use UUID for unique filenames
      const uniqueFilename = `${file.fieldname}-${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
      cb(null, uniqueFilename);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept audio files and mp4
  if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/mp4') {
      cb(null, true);
  } else {
      cb(new Error('Invalid file type. Only audio and MP4 files are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
      fileSize: 500 * 1024 * 1024 // Limit file size to 25MB
  }
});



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
        console.error('Error in ffmpeg:', err);
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
  try {
      await fs_promises.unlink(path);
      console.log(`Successfully deleted: ${path}`);
  } catch (err) {
      console.error(`Error deleting file ${path}:`, err);
  }
}

// Function to download a remote file and return its local path
async function downloadRemoteFile(remoteUrl) {
  const urlObj = new URL(remoteUrl);
  const isMp4InPath = urlObj.pathname.toLowerCase().endsWith(".mp4");
  const isMp4InMimeType = urlObj.searchParams.get("mime") === "video/mp4";
  const isMp4 = isMp4InPath || isMp4InMimeType;
  const isMp3OrMp4 = urlObj.pathname.toLowerCase().endsWith(".mp3") || isMp4;
  
  if(!isMp3OrMp4){
    throw new Error(`File is not mp3 or mp4`);
  }
  
  const fileName = `downloaded_file_${Date.now()}${isMp4 ? '.mp4' : '.mp3'}`;
  const filePath = path.join(TEMP_DIR, fileName);

  try {
    // Ensure the temp directory exists
    await fs_promises.mkdir(TEMP_DIR, { recursive: true });

    // Download the remote file as a stream and save it locally
    const response = await axios.get(remoteUrl, { responseType: "stream" });
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    return filePath;  // Return full path instead of just fileName
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
                    TEMP_DIR,
                    getAudioDuration
                };