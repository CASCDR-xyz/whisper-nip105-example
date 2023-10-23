const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const util = require('util');
const path = require('path');
require('dotenv').config();

// Promisify necessary functions
const writeFile = util.promisify(fs.writeFile);

// Initialize app
const app = express();
const port = process.env.PORT || 6969;

// Configure Multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// Handle audio file upload and transcription
app.post('/transcribe', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const audioFilePath = req.file.path; // This is your audio file path

    // Call the Python script with the audio file path
    exec(`python run_whisper.py ${audioFilePath}`, (error, stdout, stderr) => {
        if (error) {
            console.error('stderr', stderr);
            return res.status(500).send('Internal Server Error');
        }
        // Send the transcription response
        res.send(stdout);
    });
});

// Function to get the audio duration
function getAudioDuration(audioBuffer) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioBuffer)
      .on('end', (stdout, stderr) => {
        // Parse the duration from the ffmpeg output
        const durationMatch = stderr.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (durationMatch && durationMatch.length >= 2) {
          const durationString = durationMatch[1];
          const [hours, minutes, seconds] = durationString.split(':').map(parseFloat);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          resolve(totalSeconds);
        } else {
          reject('Unable to determine audio duration');
        }
      })
      .on('error', reject)
      .run();
  });
}

// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
