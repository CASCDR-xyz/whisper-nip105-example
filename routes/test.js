const express = require('express');
const router = express.Router();
const path = require('path');
const { createClient } = require("@deepgram/sdk");
const fs = require('fs').promises;
require("dotenv").config();

// Simple test endpoint to transcribe a static file
router.get('/test_deepgram', async (req, res) => {
    const filePath = path.join(__dirname, '..', 'temp', 'hls_stream_1763751875193.m4a');
    
    console.log('='.repeat(80));
    console.log('TEST ENDPOINT: Starting Deepgram transcription test');
    console.log('File path:', filePath);
    console.log('='.repeat(80));
    
    try {
        // Check if file exists
        const stats = await fs.stat(filePath);
        console.log('✅ File exists');
        console.log('File size:', stats.size, 'bytes');
        console.log('File size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
        
        // Create Deepgram client
        console.log('Creating Deepgram client...');
        const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
        
        // Read the file
        console.log('Reading file...');
        const audioBuffer = await fs.readFile(filePath);
        console.log('File read successfully, buffer size:', audioBuffer.length);
        
        // Call Deepgram
        console.log('Calling Deepgram API...');
        const startTime = Date.now();
        
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            audioBuffer,
            {
                model: "nova-2",
                smart_format: true,
                detect_language: true,
            }
        );
        
        const endTime = Date.now();
        console.log('Deepgram API call completed in', (endTime - startTime) / 1000, 'seconds');
        
        if (error) {
            console.error('❌ Deepgram returned an error:');
            console.error(JSON.stringify(error, null, 2));
            return res.status(500).json({
                success: false,
                error: error,
                errorMessage: 'Deepgram returned an error'
            });
        }
        
        console.log('✅ Deepgram success!');
        console.log('Result type:', typeof result);
        console.log('Result keys:', Object.keys(result));
        console.log('Has results:', !!result.results);
        console.log('Has metadata:', !!result.metadata);
        
        if (result.results && result.results.channels) {
            console.log('Number of channels:', result.results.channels.length);
            if (result.results.channels[0] && result.results.channels[0].alternatives) {
                console.log('Number of alternatives:', result.results.channels[0].alternatives.length);
                const transcript = result.results.channels[0].alternatives[0].transcript;
                console.log('Transcript length:', transcript.length);
                console.log('Transcript preview (first 200 chars):', transcript.substring(0, 200));
            }
        }
        
        console.log('='.repeat(80));
        console.log('FULL DEEPGRAM RESPONSE:');
        console.log(JSON.stringify(result, null, 2));
        console.log('='.repeat(80));
        
        // Return the full result
        res.json({
            success: true,
            filePath: filePath,
            fileSize: stats.size,
            processingTime: (endTime - startTime) / 1000,
            fullResult: result,
            resultsOnly: result.results,
            metadataOnly: result.metadata
        });
        
    } catch (error) {
        console.error('='.repeat(80));
        console.error('❌ ERROR in test endpoint:');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Error type:', error.constructor.name);
        console.error('='.repeat(80));
        
        res.status(500).json({
            success: false,
            error: {
                message: error.message,
                stack: error.stack,
                type: error.constructor.name
            }
        });
    }
});

module.exports = router;

