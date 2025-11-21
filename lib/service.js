const { usd_to_millisats } = require("./common");
const { getBitcoinPrice } = require("./bitcoinPrice");
const { deleteFile } = require("./fileManagement");
//const axios  = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const fsPromises = fs.promises;
const WorkProductV2 = require('../models/WorkProductV2');
const { uploadJsonData, fetchJsonData } = require ("./digitalOceanFileService");
const path = require("path");

// Add axios for URL validation
const axios = require('axios');

const { createClient } = require("@deepgram/sdk");
require("dotenv").config();

// Add constants for logging
const LOG_PREFIX = '[WHISPR-SERVICE]';
const ERROR_PREFIX = '[WHISPR-ERROR]';
const DEBUG_PREFIX = '[WHISPR-DEBUG]';

// Add file size limit constants - setting to 1.8GB (90% of Deepgram's 2GB limit)
const DEEPGRAM_MAX_FILE_SIZE_MB = 1800; // 1.8GB in MB

const {
  WHSPR_SCHEMA
} = require('../const/serviceSchema');

const DigitalOceanSpacesManager = require('../lib/DigitalOceanSpacesManager');

// Helper for better logging
function logRequest(message, data = null) {
  console.log(`${LOG_PREFIX} ${message}`);
  if (data) {
    console.log(`${LOG_PREFIX} Data:`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  }
}

function logError(message, error = null) {
  console.error(`${ERROR_PREFIX} ${message}`);
  if (error) {
    if (error.response) {
      console.error(`${ERROR_PREFIX} Response Status:`, error.response.status);
      console.error(`${ERROR_PREFIX} Response Headers:`, JSON.stringify(error.response.headers, null, 2));
      console.error(`${ERROR_PREFIX} Response Data:`, JSON.stringify(error.response.data, null, 2));
    }
    console.error(`${ERROR_PREFIX} Stack:`, error.stack);
  }
}

function logDebug(message, data = null) {
  console.log(`${DEBUG_PREFIX} ${message}`);
  if (data) {
    console.log(`${DEBUG_PREFIX} Data:`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  }
}

// Add URL validation helper
async function validateUrl(url) {
  logDebug(`Validating URL: ${url}`);
  try {
    // Just check the headers to see if the URL is accessible and what content type it has
    const response = await axios.head(url, {
      timeout: 10000,
      validateStatus: status => status < 500 // Accept any non-server error status
    });
    
    const statusCode = response.status;
    const contentType = response.headers['content-type'] || 'unknown';
    const contentLength = response.headers['content-length'] || 'unknown';
    
    // Check for file size if content-length header is present
    let fileSizeInfo = null;
    if (contentLength && !isNaN(parseInt(contentLength, 10))) {
      const fileSizeBytes = parseInt(contentLength, 10);
      const fileSizeKB = fileSizeBytes / 1024;
      const fileSizeMB = fileSizeKB / 1024;
      
      fileSizeInfo = {
        bytes: fileSizeBytes,
        kb: fileSizeKB,
        mb: fileSizeMB
      };
      
      logDebug(`Remote file size detected: ${fileSizeMB.toFixed(2)} MB`);
    }
    
    logDebug(`URL validation results`, { 
      url, 
      statusCode,
      contentType,
      contentLength,
      fileSizeInfo,
      isAudio: contentType.includes('audio') || url.includes('.mp3') || url.includes('.wav') || url.includes('.m4a')
    });
    
    return {
      isValid: statusCode >= 200 && statusCode < 400,
      statusCode,
      contentType,
      contentLength,
      fileSizeInfo,
      isAudio: contentType.includes('audio') || url.includes('.mp3') || url.includes('.wav') || url.includes('.m4a')
    };
  } catch (error) {
    logError(`URL validation failed for: ${url}`, error);
    return {
      isValid: false,
      error: error.message
    };
  }
}

const transcribeLocalFile = async (filePath) => {
  logRequest(`Attempting to transcribe local file: ${filePath}`);

  if (!filePath) {
    const error = new Error("No file path provided for transcription");
    logError("Missing file path", error);
    throw error;
  }

  try {
    // STEP 1: Create a Deepgram client using the API key
    logDebug("Creating Deepgram client");
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

    // STEP 2: Read the file
    logDebug(`Reading file from disk: ${filePath}`);
    let audioBuffer;
    try {
      audioBuffer = await fsPromises.readFile(filePath);
      logDebug(`Successfully read ${audioBuffer.length} bytes`);
    } catch (readError) {
      logError(`Failed to read audio file: ${filePath}`, readError);
      throw readError;
    }

    // STEP 3: Call the transcribeFile method with the audio payload and options
    logDebug("Calling Deepgram transcribeFile API");
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      // STEP 4: Configure Deepgram options for audio analysis
      {
        model: "nova-2",
        smart_format: true,
        detect_language: true, // Enable language detection
      }
    );

    if (error) {
      logError("Deepgram transcription error", error);
      throw error;
    }

    // STEP 5: Return the results
    logRequest("Transcription successful");
    return result;
  } catch (error) {
    logError("Error in transcribeLocalFile", error);
    throw error;
  }
};


const transcribeUrl = async (url) => {
  logRequest(`Attempting to transcribe URL: ${url}`);
  logRequest(`Maximum file size for direct URL transcription: ${DEEPGRAM_MAX_FILE_SIZE_MB} MB`);

  if (!url) {
    const error = new Error("No URL provided for transcription");
    logError("Missing URL", error);
    throw error;
  }

  try {
    // Validate URL before sending to Deepgram
    logDebug("Validating URL before sending to Deepgram");
    const urlValidation = await validateUrl(url);
    logDebug("URL validation results", urlValidation);
    
    if (!urlValidation.isValid) {
      const error = new Error(`Invalid URL: ${url} - Validation failed: ${urlValidation.error || 'Unknown error'}`);
      logError("URL validation failed", error);
      throw error;
    }
    
    // Check file size limit
    if (urlValidation.fileSizeInfo && urlValidation.fileSizeInfo.mb > DEEPGRAM_MAX_FILE_SIZE_MB) {
      const fileSizeErrorMsg = `File is too large for direct URL transcription: ${urlValidation.fileSizeInfo.mb.toFixed(2)} MB exceeds the ${DEEPGRAM_MAX_FILE_SIZE_MB} MB limit`;
      console.error(`❌ FILE SIZE ERROR: ${fileSizeErrorMsg}`);
      console.error(`❌ URL: ${url}`);
      const error = new Error(fileSizeErrorMsg);
      error.code = 'FILE_TOO_LARGE';
      logError("File size limit exceeded", error);
      throw error;
    }

    // Log detailed information about the URL for debugging
    let urlDetails = {};
    try {
      const parsedUrl = new URL(url);
      urlDetails = {
        url,
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        pathname: parsedUrl.pathname,
        search: parsedUrl.search,
        extension: path.extname(parsedUrl.pathname),
        contentType: urlValidation.contentType,
        contentLength: urlValidation.contentLength,
        sizeInMb: urlValidation.fileSizeInfo ? urlValidation.fileSizeInfo.mb.toFixed(2) : 'unknown'
      };
      logDebug("URL details", urlDetails);
    } catch (parseError) {
      logError(`Error parsing URL: ${url}`, parseError);
    }
    
    // STEP 1: Create a Deepgram client using the API key
    logDebug("Creating Deepgram client");
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    
    // STEP 2: Call the transcribeUrl method with the audio payload and options
    logDebug("Calling Deepgram transcribeUrl API with URL", { url });
    const { result, error } = await deepgram.listen.prerecorded.transcribeUrl(
      {
        url: url,
      },
      // STEP 3: Configure Deepgram options for audio analysis
      {
        model: "nova-2",
        smart_format: true,
      }
    );

    if (error) {
      logError("Deepgram transcription error", error);
      throw error;
    }

    // STEP 4: Print the results
    logRequest("Transcription successful", { 
      resultSummary: {
        duration: result?.metadata?.duration,
        channels: result?.results?.channels?.length,
        success: !!result?.results
      }
    });
    return result;
  } catch (error) {
    logError(`Error in transcribeUrl for: ${url}`, error);
    throw error;
  }
};

// don't need this for now but its here in case
function sanitizeData(data, schema) {
  if (schema.type === "object" && schema.properties) {
      const newObj = {};
      for (const key in schema.properties) {
          if (data.hasOwnProperty(key)) {
              newObj[key] = sanitizeData(data[key], schema.properties[key]);
          }
      }
      return newObj;
  } else if (schema.type === "array" && schema.items) {
      if (Array.isArray(data)) {
          return data.map(item => sanitizeData(item, schema.items));
      }
      return [];
  } else {
      return data;
  }
}

async function getServicePrice(service, durationInSeconds) {
  console.log("getServicePrice service:",service)
  const bitcoinPrice = await getBitcoinPrice();
  console.log("bitcoinPrice:",bitcoinPrice)
  const units_count = durationInSeconds / 60.0;//assuming MINS for now. Would need to make this a function to support more units
  const fixedUsd = parseFloat(process.env.WHSPR_FIXED_USD);
  const variableUsd = parseFloat(process.env.WHSPR_VARIABLE_USD);
  const totalUsd = fixedUsd + (units_count * variableUsd);
  switch (service) {
    case "WHSPR":
      return usd_to_millisats(totalUsd,bitcoinPrice);
    default:
      return usd_to_millisats(totalUsd,bitcoinPrice);
  }
}

function submitService(service, data) {
  logRequest('Submitting service request', { service, dataKeys: Object.keys(data) });
  logDebug('Complete request data', data);
  
  // Check for required parameters
  if (!data.remote_url && !data.filePath) {
    const error = new Error('Either file path or remote URL is required in submitService');
    logError('Missing required parameters', error);
    console.error(`❌ SUBMISSION ERROR: ${error.message}`);
    throw error;
  }
  
  // Create a copy of data to avoid modifying the original
  const processData = {...data};
  
  // If we only have remote_url but no filePath, add a placeholder filePath
  if (data.remote_url && !data.filePath) {
    logRequest('Remote URL provided without filePath, adding placeholder filePath');
    try {
      const urlObj = new URL(data.remote_url);
      processData.filePath = `/tmp/${path.basename(urlObj.pathname) || 'audio-file.mp3'}`;
      logDebug('Added placeholder filePath', { originalUrl: data.remote_url, filePath: processData.filePath });
    } catch (error) {
      logError('Error parsing remote URL to create placeholder filePath', error);
      console.error(`❌ URL PARSING ERROR: Could not parse URL: ${data.remote_url}`);
      processData.filePath = '/tmp/audio-file.mp3'; // Fallback to a default name
    }
  }
  
  switch (service) {
    case "WHSPR":
      const whisperLocal = false;
      logRequest('Calling callWhisper', { local: whisperLocal });
      console.log(`🎯🎯🎯 ABOUT TO CALL callWhisper with data:`, JSON.stringify(processData, null, 2));
      try {
        const result = callWhisper(processData, whisperLocal);
        console.log(`🎯🎯🎯 callWhisper RETURNED (this is a Promise)`);
        console.log(`🎯🎯🎯 Result type: ${typeof result}`);
        console.log(`🎯🎯🎯 Is Promise: ${result instanceof Promise}`);
        return result;
      } catch (error) {
        console.error(`❌❌❌ WHISPER ERROR: Failed to process audio: ${error.message}`);
        console.error(`❌❌❌ Error stack: ${error.stack}`);
        throw error;
      }
    default:
      const error = new Error(`Unsupported service: ${service}`);
      logError('Unsupported service', error);
      console.error(`❌ SERVICE ERROR: ${error.message}`);
      throw error;
  }
}

async function callWhisper(data, runWhisperLocally) {
  logRequest('Processing transcription request', { 
    hasRemoteUrl: !!data.remote_url, 
    hasFilePath: !!data.filePath,
    hasGuid: !!data.guid,
    runWhisperLocally 
  });

  return new Promise(async (resolve, reject) => {
      let existingTranscript;
      let transcriptData;
      
      // Try to find existing transcript if guid is provided
      if(data.guid) {
        logRequest(`Checking for existing transcript with guid: ${data.guid}`);
        try {
          existingTranscript = await WorkProductV2.findOne({lookupHash: data.guid}).exec();
          logDebug('Existing transcript query result', { 
            found: !!existingTranscript,
            hasCdnFileId: existingTranscript?.cdnFileId ? true : false
          });
          
          if (existingTranscript && existingTranscript?.cdnFileId) {
              const DOFileId = existingTranscript.cdnFileId;
              logRequest(`Found existing transcript, fetching JSON data for file: ${DOFileId}`);
              
              try {
                transcriptData = await fetchJsonData('cascdr-transcripts', DOFileId);
                logDebug(`Fetched transcript data type: ${typeof transcriptData}`);
                
                // If transcriptData is null, it means the file doesn't exist in the bucket
                if (transcriptData === null) {
                  logError(`Transcript file ${DOFileId} exists in database but not in storage bucket`);
                  
                  // Check if we have results directly in the MongoDB document
                  if (existingTranscript.result && Object.keys(existingTranscript.result).length > 0) {
                    logRequest(`Found transcript data in MongoDB document, using that instead`);
                    console.log(`Using transcript from MongoDB document ${existingTranscript._id}`);
                    
                    // Log preview of transcript if available
                    try {
                      const previewText = existingTranscript.result.channels[0].alternatives[0].transcript.substring(0, 200);
                      console.log(`Transcript preview from MongoDB: ${previewText}...`);
                    } catch (e) {
                      console.log(`Could not extract preview text from MongoDB document`);
                    }
                    
                    resolve(existingTranscript.result);
                    return;
                  }
                  
                  logRequest(`Will process the file again since transcript data is missing`);
                  // Continue to processing - don't return
                } else {
                  // If the result is stored as a string, parse it
                  if (typeof transcriptData === 'string') {
                      try {
                          transcriptData = JSON.parse(transcriptData);
                          logRequest("Successfully parsed existing transcript data");
                          resolve(transcriptData);
                          return;
                      } catch (parseError) {
                          logError('Failed to parse existing transcript data', parseError);
                          // Continue to processing since parsing failed
                      }
                  }
                  else if(typeof transcriptData === 'object'){
                      logRequest("Using existing transcript data (object)");
                      resolve(transcriptData);
                      return;
                  }
                }
              } catch (fetchError) {
                logError(`Error fetching existing transcript data: ${DOFileId}`, fetchError);
                // Continue to processing since fetch failed
              }
          } else {
            logRequest(`No existing transcript found for guid: ${data.guid}`);
          }
        } catch (dbError) {
          logError(`Database error when checking for existing transcript: ${data.guid}`, dbError);
        }
      }
      
      // Check if we have a remote URL for direct transcription
      if (data.remote_url) {
        const remoteUrl = data.remote_url;
        logRequest(`Processing remote URL: ${remoteUrl}`);
        
        // Extract file extension more safely
        let fileExtension = '';
        try {
          const parsedUrl = new URL(remoteUrl);
          fileExtension = path.extname(parsedUrl.pathname).toLowerCase();
          logDebug(`Parsed URL info`, {
            hostname: parsedUrl.hostname,
            pathname: parsedUrl.pathname,
            fileExtension: fileExtension || 'none'
          });
        } catch (parseError) {
          logError(`Error parsing URL: ${remoteUrl}`, parseError);
        }
        
        // Always attempt direct URL transcription regardless of extension
        logRequest(`Attempting direct transcription of remote URL: ${remoteUrl}`);
        
        try {
          // Use Deepgram's URL transcription API directly
          logDebug(`Calling transcribeUrl for: ${remoteUrl}`);
          const result = await transcribeUrl(remoteUrl);
          logRequest(`Successfully transcribed URL directly: ${remoteUrl}`);
          
          // Add more detailed logging of the result
          logDebug("Deepgram transcription result structure", {
            hasResults: !!result?.results,
            hasMetadata: !!result?.metadata,
            resultType: typeof result?.results,
            channels: result?.results?.channels?.length || 0,
            duration: result?.metadata?.duration || 'unknown'
          });
          
          if (result && result.results && result.results.channels && result.results.channels.length > 0) {
            // Store the transcript JSON for future use
            if (!existingTranscript && data.guid) {
              logRequest(`Caching transcript for guid: ${data.guid}`);
              try {
                const resultsJsonString = JSON.stringify(result.results, null, 2);
                logDebug(`Creating new WorkProductV2 document for guid: ${data.guid}`);
                
                const newDocument = new WorkProductV2({
                  type: 'rss transcript',
                  result: result.results,
                  lookupHash: data.guid,
                  cdnFileId: `${data.guid}.json`
                });
                
                try {
                  await newDocument.save();
                  logRequest(`Saved new WorkProductV2 document with id: ${newDocument._id}`);
                } catch (saveError) {
                  logError(`Error saving WorkProductV2 document for guid: ${data.guid}`, saveError);
                }
                
                try {
                  await uploadJsonData('cascdr-transcripts', `${data.guid}.json`, resultsJsonString);
                  logRequest(`Uploaded transcript JSON data for guid: ${data.guid}`);
                } catch (uploadError) {
                  logError(`Error uploading transcript JSON for guid: ${data.guid}`, uploadError);
                }
              } catch (cacheError) {
                logError(`Error caching transcript for guid: ${data.guid}`, cacheError);
                // Continue - the transcription was successful
              }
            }
            
            // Log the transcript text for debugging
            let transcriptText = '';
            try {
              transcriptText = result.results.channels[0].alternatives[0].transcript;
              console.log(`TRANSCRIPT PREVIEW (first 200 chars): ${transcriptText.substring(0, 200)}...`);
            } catch (e) {
              console.error(`Failed to extract transcript text: ${e.message}`);
            }
            
            // Resolve with the transcription results
            logRequest(`Resolving with direct URL transcription results`);
            resolve(result.results);
            return;
          } else {
            logError(`Direct URL transcription succeeded but returned no results for: ${remoteUrl}`);
          }
        } catch (transcriptionError) {
          // Check if the error is related to file size limitations
          const isFileSizeError = transcriptionError.code === 'FILE_TOO_LARGE' || 
            (transcriptionError.message && 
            (transcriptionError.message.includes('too large') || 
             transcriptionError.message.includes('exceeds') && 
             transcriptionError.message.includes('limit')));
          
          if (isFileSizeError) {
            console.error(`❌ FILE SIZE EXCEEDED: File at ${remoteUrl} is too large to transcribe directly`);
            console.error(`❌ Error details: ${transcriptionError.message}`);
            console.error(`❌ Falling back to local file processing due to file size limitations...`);
            
            logError(`File size limit exceeded for direct URL transcription: ${remoteUrl}`, transcriptionError);
            logRequest(`Falling back to local file processing due to file size limitations...`);
          } else {
            logError(`Error transcribing URL directly: ${remoteUrl}`, transcriptionError);
            logRequest(`Falling back to local file processing...`);
          }
          // Fall through to normal processing if direct transcription fails
        }
      }
      
      // Continue with standard local file processing if remote URL optimization didn't work
      const audioFilePath = data.filePath;
      logRequest(`Falling back to local file processing with path: ${audioFilePath}`);
      
      // Only validate filePath if we've reached this point (remote URL processing failed or wasn't attempted)
      if (!audioFilePath) {
          const errorMsg = data.remote_url 
            ? `Failed to process remote URL (${data.remote_url}) and no valid filePath provided.` 
            : 'Audio file path not found.';
          logError(errorMsg);
          reject(new Error(errorMsg));
          return;
      }

      // Check if file exists before proceeding
      try {
        const fileStats = await fsPromises.stat(audioFilePath);
        logDebug(`File exists and is ${fileStats.size} bytes`);
        if (fileStats.size === 0) {
          const error = new Error(`Audio file exists but is empty (0 bytes): ${audioFilePath}`);
          logError('Empty file', error);
          reject(error);
          return;
        }
      } catch (statError) {
        const error = new Error(`Audio file not found or inaccessible: ${audioFilePath}`);
        logError('File access error', error);
        reject(error);
        return;
      }

      if (runWhisperLocally) {
          logRequest(`Running whisper locally with Python script for: ${audioFilePath}`);
          // Call the Python script with the audio file path
          exec(`python3 run_whisper.py ${audioFilePath}`, (error, stdout, stderr) => {
              if (error) {
                  logError(`Error running local whisper script`, { error, stderr });
                  reject(new Error('Failed to transcribe audio locally.'));
                  return;
              }

              // Delete the file after processing and saving transcription
              try {
                  fs.unlinkSync(audioFilePath);
                  logRequest(`Successfully deleted temporary file: ${audioFilePath}`);
              } catch (unlinkError) {
                  logError(`Error deleting temporary file: ${audioFilePath}`, unlinkError);
              }
              
              // Return the transcription response
              logRequest(`Local whisper transcription successful`);
              resolve(stdout);
          });
      } else {
          logRequest(`Transcribing local file with Deepgram: ${audioFilePath}`);
          try {
            console.log(`🎤🎤🎤 CALLING transcribeLocalFile with: ${audioFilePath}`);
            const result = await transcribeLocalFile(audioFilePath);
            console.log(`🎤🎤🎤 transcribeLocalFile RETURNED`);
            console.log(`🎤🎤🎤 Result type: ${typeof result}`);
            console.log(`🎤🎤🎤 Result keys: ${result ? Object.keys(result).join(', ') : 'none'}`);
            console.log(`🎤🎤🎤 FULL RESULT OBJECT:`);
            console.log(JSON.stringify(result, null, 2));
            console.log(`🎤🎤🎤 END FULL RESULT`);
            
            logRequest(`Successfully transcribed local file: ${audioFilePath}`);
            logDebug("Transcription result summary", { 
              hasResults: !!result.results,
              duration: result?.metadata?.duration || 'unknown',
              channels: result?.results?.channels?.length || 0
            });
            
            console.log(`🎯🎯🎯 ABOUT TO RESOLVE WITH result.results`);
            console.log(`🎯🎯🎯 result.results type: ${typeof result.results}`);
            console.log(`🎯🎯🎯 result.results keys: ${result.results ? Object.keys(result.results).join(', ') : 'none'}`);
            console.log(`🎯🎯🎯 FULL result.results OBJECT:`);
            console.log(JSON.stringify(result.results, null, 2));
            console.log(`🎯🎯🎯 END result.results`);
            
            resolve(result.results);
            const resultsJsonString = JSON.stringify(result.results, null, 2);

            try {
              deleteFile(audioFilePath);
              logRequest(`Deleted temporary file: ${audioFilePath}`);
            } catch (deleteError) {
              logError(`Failed to delete temporary file: ${audioFilePath}`, deleteError);
            }
            
            if(!existingTranscript && data.guid){
              logRequest(`Caching transcript for guid: ${data.guid}`);
              try {
                const newDocument = new WorkProductV2({
                    type: 'rss transcript',
                    result: result.results,
                    lookupHash: data.guid,
                    cdnFileId: `${data.guid}.json`
                });
                await newDocument.save();
                logRequest(`Saved new WorkProductV2 document with id: ${newDocument._id}`);
                
                await uploadJsonData('cascdr-transcripts', `${data.guid}.json`, resultsJsonString);
                logRequest(`Uploaded transcript JSON data for guid: ${data.guid}`);
              } catch (cacheError) {
                logError(`Error caching transcript from local file for guid: ${data.guid}`, cacheError);
              }
            }
            
            // Log the transcript text for debugging
            let transcriptText = '';
            try {
              transcriptText = result.results.channels[0].alternatives[0].transcript;
              console.log(`LOCAL FILE TRANSCRIPT PREVIEW (first 200 chars): ${transcriptText.substring(0, 200)}...`);
            } catch (e) {
              console.error(`Failed to extract transcript text from local file: ${e.message}`);
            }

          } catch (transcribeError) {
            logError(`Error transcribing local file: ${audioFilePath}`, transcribeError);
            reject(new Error(`Failed to transcribe audio via API. Error: ${transcribeError.message}`));
          }
      }
  });
}

module.exports = { submitService, getServicePrice, transcribeUrl, transcribeLocalFile };