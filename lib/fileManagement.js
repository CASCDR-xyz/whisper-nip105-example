const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const fs_promises = require('fs').promises;
const path = require('path');
const ffmpeg = require("fluent-ffmpeg");
const TEMP_DIR = process.env.NODE_ENV === 'production' 
  ? '/app/temp'
  : path.join(__dirname, '..', 'temp');

// Get file size limit from environment variable or default to 500MB
const FILE_SIZE_LIMIT_MB = parseInt(process.env.FILE_SIZE_LIMIT_MB || "1800", 10);

const ALLOWED_AUDIO_MIMETYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/x-m4a'];
const ALLOWED_VIDEO_MIMETYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/x-flv', 'video/webm'];



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
  const mimetype = file.mimetype.toLowerCase();
  const extension = path.extname(file.originalname).toLowerCase();

  if (ALLOWED_AUDIO_MIMETYPES.includes(mimetype) || ALLOWED_VIDEO_MIMETYPES.includes(mimetype)) {
    cb(null, true);
  } else if (extension === '.mp3' || extension === '.wav' || extension === '.ogg' || 
             extension === '.flac' || extension === '.m4a' || extension === '.mp4' || 
             extension === '.mov' || extension === '.avi' || extension === '.wmv' || 
             extension === '.flv' || extension === '.webm') {
    // If mimetype check fails, fall back to file extension check
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed types: MP3, WAV, OGG, FLAC, M4A, MP4, MOV, AVI, WMV, FLV, WebM'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
      fileSize: FILE_SIZE_LIMIT_MB * 1024 * 1024 // Limit file size based on env variable
  }
});



async function isMp4File(filePath) {
  const fileExtension = path.extname(filePath);
  return fileExtension === '.mp4';
}

async function extractAudioFromVideo(inputFilePath, outputFilePath) {
  console.log(`Extracting audio from: ${inputFilePath} and saving it to ${outputFilePath}`);
  
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputFilePath)
      .audioCodec('libmp3lame')
      .toFormat('mp3')
      .on('start', (commandLine) => {
        console.log('FFmpeg process started:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Processing: ${progress.percent}% done`);
      })
      .on('end', () => {
        console.log('Audio extraction completed');
        deleteFile(inputFilePath)
          .then(() => resolve())
          .catch((err) => {
            console.warn(`Warning: Could not delete input file: ${err.message}`);
            resolve();  // Resolve anyway, as the extraction was successful
          });
      })
      .on('error', (err) => {
        console.error('Error in ffmpeg:', err);
        deleteFile(inputFilePath)
          .catch((delErr) => console.warn(`Warning: Could not delete input file: ${delErr.message}`));
        reject(err);
      })
      .save(outputFilePath);
  });
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

// Helper function to reduce duplication in m3u8 download
function createM3u8FfmpegCommand(m3u8Url, filePath, useCodecCopy = true) {
  const command = ffmpeg(m3u8Url)
    .inputOptions([
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto'
    ])
    .noVideo();  // Extract audio only, discard video completely
  
  if (useCodecCopy) {
    // When copying codec, let FFmpeg use the source format (usually aac or mp3)
    command.audioCodec('copy');
    // Don't specify format, let FFmpeg auto-detect from file extension
  } else {
    // Try different audio codecs in order of preference
    // AAC is more universally available than MP3 in FFmpeg builds
    command.audioCodec('aac').audioBitrate('128k');
  }
  
  return command;
}

// Download m3u8 HLS stream and extract audio only (optimized for speed & reliability)
async function downloadM3u8Stream(m3u8Url) {
  console.log(`📺 Downloading HLS stream from: ${m3u8Url}`);
  console.log(`🎯 Strategy: Extract audio-only from lowest bandwidth variant`);
  
  // Use .m4a extension (AAC in MP4 container) which is universally supported
  // Deepgram supports: MP3, MP4, AAC, WAV, FLAC, etc.
  const fileName = `hls_stream_${Date.now()}.m4a`;
  const filePath = path.join(TEMP_DIR, fileName);
  
  // Ensure temp directory exists
  await fs_promises.mkdir(TEMP_DIR, { recursive: true });
  
  // Try codec copy first (fastest), fall back to re-encoding if it fails
  try {
    console.log(`⚡ Attempting fast audio extraction (codec copy)...`);
    await downloadM3u8WithCodec(m3u8Url, filePath, true);
    console.log(`✅ Fast extraction successful!`);
    return filePath;
  } catch (codecCopyError) {
    console.log(`⚠️  Codec copy failed, falling back to re-encoding...`);
    console.log(`Error was: ${codecCopyError.message}`);
    
    try {
      await downloadM3u8WithCodec(m3u8Url, filePath, false);
      console.log(`✅ Re-encoded audio extraction successful!`);
      return filePath;
    } catch (reencodeError) {
      console.error(`❌ Both methods failed for HLS stream`);
      throw new Error(`Failed to download HLS stream: ${reencodeError.message}`);
    }
  }
}

// DRY helper for m3u8 download
async function downloadM3u8WithCodec(m3u8Url, filePath, useCodecCopy) {
  return new Promise((resolve, reject) => {
    const command = createM3u8FfmpegCommand(m3u8Url, filePath, useCodecCopy);
    
    command
      .on('start', (commandLine) => {
        console.log(`FFmpeg command: ${commandLine}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`Progress: ${Math.round(progress.percent)}% done, time: ${progress.timemark}`);
        }
      })
      .on('end', () => {
        console.log(`HLS stream download complete: ${filePath}`);
        resolve(filePath);
      })
      .on('error', (err) => {
        console.error(`FFmpeg error: ${err.message}`);
        reject(err);
      })
      .save(filePath);
  });
}

// Check if URL is an m3u8 stream
function isM3u8Url(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    return pathname.endsWith('.m3u8') || pathname.includes('.m3u8?');
  } catch (error) {
    return false;
  }
}

// Function to download a remote file and return its local path
async function downloadRemoteFile(remoteUrl) {
  const urlObj = new URL(remoteUrl);
  const pathname = urlObj.pathname.toLowerCase();
  const mimeType = urlObj.searchParams.get("mime");
  
  // Check for mp4 specifically since it can be indicated in two ways
  const isMp4InPath = pathname.endsWith(".mp4");
  const isMp4InMimeType = mimeType === "video/mp4";
  const isMp4 = isMp4InPath || isMp4InMimeType;
  
  // Check for audio extensions
  const isAudioFile = pathname.endsWith(".mp3") || 
                      pathname.endsWith(".m4a") || 
                      pathname.endsWith(".wav");
  
  if (!isAudioFile && !isMp4) {
    throw new Error(`File must be mp3, mp4, m4a, or wav`);
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

async function getRemoteFileSize(remoteUrl) {
  try {
    const response = await axios.head(remoteUrl);
    const contentLength = response.headers['content-length'];
    
    if (!contentLength) {
      console.warn('⚠️ Content-Length header not available for remote file');
      return null;
    }
    
    const fileSizeBytes = parseInt(contentLength, 10);
    const fileSizeKB = fileSizeBytes / 1024;
    const fileSizeMB = fileSizeKB / 1024;

    console.log(`Remote file size: ${fileSizeBytes} bytes`);
    console.log(`Remote file size: ${fileSizeKB} KB`);
    console.log(`Remote file size: ${fileSizeMB} MB`);
    
    // Add prominent warning if file is close to or exceeds limit
    if (fileSizeMB > FILE_SIZE_LIMIT_MB * 0.8) {
      if (fileSizeMB > FILE_SIZE_LIMIT_MB) {
        console.error(`❌ FILE SIZE ERROR: File is ${fileSizeMB.toFixed(2)}MB, which exceeds the limit of ${FILE_SIZE_LIMIT_MB}MB`);
      } else {
        console.warn(`⚠️ FILE SIZE WARNING: File is ${fileSizeMB.toFixed(2)}MB, which is approaching the limit of ${FILE_SIZE_LIMIT_MB}MB`);
      }
    }
    
    return { 
      bytes: fileSizeBytes,
      kb: fileSizeKB,
      mb: fileSizeMB
    };
  } catch (error) {
    console.error(`❌ Error checking remote file size: ${error.message}`);
    return null;
  }
}

// Fix the validateAudioSize function to properly return a Promise
async function validateAudioSize(audioFilePath) {
  // Use the environment variable for the limit
  const limit = FILE_SIZE_LIMIT_MB;
  
  return new Promise((resolve, reject) => {
    fs.stat(audioFilePath, (err, stats) => {
      if (err) {
        console.error('❌ Error reading file information:', err);
        resolve(false);
      } else {
        // File size in bytes
        const fileSizeBytes = stats.size;

        // Convert bytes to kilobytes (KB) or megabytes (MB) for more readable output
        const fileSizeKB = fileSizeBytes / 1024;
        const fileSizeMB = fileSizeKB / 1024;

        console.log(`File size: ${fileSizeBytes} bytes`);
        console.log(`File size: ${fileSizeKB} KB`);
        console.log(`File size: ${fileSizeMB} MB`);
        console.log(`File size limit: ${limit} MB`);
        
        if (fileSizeMB >= limit) {
          console.error(`❌ FILE SIZE ERROR: File at '${audioFilePath}' is ${fileSizeMB.toFixed(2)}MB, which exceeds the limit of ${limit}MB`);
          resolve(false);
        } else {
          if (fileSizeMB > limit * 0.8) {
            console.warn(`⚠️ FILE SIZE WARNING: File is ${fileSizeMB.toFixed(2)}MB, which is approaching the limit of ${limit}MB`);
          }
          resolve(true);
        }
      }
    });
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

async function convertToMp3(inputFilePath, outputFilePath) {
  console.log(`Converting audio file: ${inputFilePath} to MP3: ${outputFilePath}`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputFilePath)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .on('start', (commandLine) => {
        console.log('FFmpeg process started:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Processing: ${progress.percent}% done`);
      })
      .on('end', async () => {
        console.log('Audio conversion completed');
        try {
          await fs.unlink(inputFilePath);
          console.log(`Deleted original file: ${inputFilePath}`);
          resolve(outputFilePath);
        } catch (err) {
          console.warn(`Warning: Could not delete original file: ${err.message}`);
          resolve(outputFilePath);
        }
      })
      .on('error', async (err) => {
        console.error('Error in FFmpeg:', err);
        try {
          await fs.unlink(inputFilePath);
          console.log(`Deleted original file: ${inputFilePath}`);
        } catch (unlinkErr) {
          console.warn(`Warning: Could not delete original file: ${unlinkErr.message}`);
        }
        reject(err);
      })
      .save(outputFilePath);
  });
}


module.exports =  { getDuration, 
                    upload, 
                    isMp4File, 
                    extractAudioFromMp4, 
                    extractAudioFromVideo,
                    deleteFile,
                    downloadRemoteFile,
                    validateAudioSize,
                    getRemoteFileSize,
                    TEMP_DIR,
                    getAudioDuration,
                    convertToMp3,
                    FILE_SIZE_LIMIT_MB,
                    downloadM3u8Stream,
                    isM3u8Url
                };