#!/usr/bin/env node

/**
 * Whispr Service URL Tester
 * 
 * This script tests URLs with the transcription service to diagnose issues
 * with 400 errors or other problems.
 * 
 * Usage:
 * node url-tester.js <url-to-test> [--verbose] [--simulate-client]
 */

const axios = require('axios');
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const path = require('path');
require('dotenv').config();

// Configuration
const config = {
  SHARED_SECRET: process.env.SHARED_HMAC_SECRET || 'test-secret',
  WHISPR_BASE_URL: process.env.RUN_LOCAL === 'true' 
    ? 'http://localhost:5004/WHSPR'
    : 'https://whispr-v3-w-caching-ex8zk.ondigitalocean.app/WHSPR',
  VERBOSE: false,
  SIMULATE_CLIENT: false,
  HTTP_TIMEOUT: 30000
};

// ANSI color codes for terminal output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

// Print functions
function log(message) {
  console.log(message);
}

function success(message) {
  console.log(`${colors.green}✓ ${message}${colors.reset}`);
}

function error(message) {
  console.error(`${colors.red}✗ ${message}${colors.reset}`);
}

function info(message) {
  console.log(`${colors.blue}ℹ ${message}${colors.reset}`);
}

function warn(message) {
  console.log(`${colors.yellow}⚠ ${message}${colors.reset}`);
}

function debug(message) {
  if (config.VERBOSE) {
    console.log(`${colors.cyan}🔍 ${message}${colors.reset}`);
  }
}

function section(title) {
  console.log(`\n${colors.bold}${colors.magenta}=== ${title} ===${colors.reset}\n`);
}

/**
 * Validate a URL by checking its headers
 */
async function validateUrl(url) {
  try {
    debug(`Checking URL headers: ${url}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await axios.head(url, {
      validateStatus: () => true, // Accept any status code
      signal: controller.signal,
      timeout: 10000
    });
    
    clearTimeout(timeout);
    
    const contentType = response.headers['content-type'] || 'unknown';
    const contentLength = response.headers['content-length'] || 'unknown';
    
    debug(`Status: ${response.status}`);
    debug(`Content-Type: ${contentType}`);
    debug(`Content-Length: ${contentLength}`);
    
    return {
      url,
      status: response.status,
      headers: response.headers,
      isValid: response.status >= 200 && response.status < 400,
      contentType,
      contentLength,
      isAudio: contentType.includes('audio') || 
               url.includes('.mp3') || 
               url.includes('.wav') || 
               url.includes('.m4a')
    };
  } catch (err) {
    return {
      url,
      isValid: false,
      error: err.message,
      isTimeout: err.code === 'ECONNABORTED'
    };
  }
}

/**
 * Follow redirects to get the final URL
 */
async function followRedirects(url, maxRedirects = 5) {
  let currentUrl = url;
  let redirectCount = 0;
  
  try {
    while (redirectCount < maxRedirects) {
      debug(`Following redirect ${redirectCount + 1}: ${currentUrl}`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const response = await axios.head(currentUrl, {
        maxRedirects: 0,
        validateStatus: status => status < 500,
        signal: controller.signal,
        timeout: 10000
      });
      
      clearTimeout(timeout);
      
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        redirectCount++;
        const nextUrl = new URL(response.headers.location, currentUrl).href;
        debug(`Redirected to: ${nextUrl}`);
        currentUrl = nextUrl;
      } else {
        break;
      }
    }
    
    return { 
      finalUrl: currentUrl,
      redirectCount, 
      tooManyRedirects: redirectCount >= maxRedirects
    };
  } catch (err) {
    return { 
      finalUrl: currentUrl, 
      redirectCount, 
      error: err.message
    };
  }
}

/**
 * Analyze a URL and check for common issues
 */
function analyzeUrl(url) {
  try {
    const parsed = new URL(url);
    const issues = [];
    
    // Check file extension
    const ext = path.extname(parsed.pathname).toLowerCase();
    if (!ext || !['.mp3', '.m4a', '.wav'].includes(ext)) {
      issues.push(`URL doesn't have a recognized audio file extension (${ext || 'none'}). Expected .mp3, .m4a, or .wav.`);
    }
    
    // Check for query parameters
    if (parsed.search && parsed.search.length > 0) {
      issues.push(`URL contains query parameters: "${parsed.search}". This might cause issues.`);
    }
    
    // Check for hash fragments
    if (parsed.hash && parsed.hash.length > 0) {
      issues.push(`URL contains a hash fragment: "${parsed.hash}". This will be ignored by the server.`);
    }
    
    // Check for special characters
    if (parsed.pathname.includes(' ') || /[^\x20-\x7E]/.test(parsed.pathname)) {
      issues.push('URL contains spaces or special characters that might need encoding.');
    }
    
    // Check for localhost or private IPs
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      issues.push('URL points to localhost, which is not accessible from remote servers.');
    }
    
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1]))/.test(parsed.hostname)) {
      issues.push('URL points to a private IP address, which is not accessible from the internet.');
    }
    
    return {
      parsed,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      extension: ext,
      issues
    };
  } catch (err) {
    return {
      error: `Failed to parse URL: ${err.message}`,
      issues: [`Invalid URL format: ${err.message}`]
    };
  }
}

/**
 * Test a URL with the Whispr service
 */
async function testUrlWithWhispr(url) {
  try {
    const timestamp = String(Date.now());
    const hmac = crypto.createHmac('sha256', config.SHARED_SECRET)
      .update(timestamp)
      .digest('hex');
    
    const guid = `test-url-${Date.now()}`;
    
    info(`Testing URL with Whispr service: ${url}`);
    info(`Using guid: ${guid}`);
    
    // Prepare request data
    const requestData = config.SIMULATE_CLIENT
      ? { remote_url: url, guid }
      : { remote_url: url, guid, filePath: '/tmp/placeholder.mp3' };
    
    debug(`Request data: ${JSON.stringify(requestData, null, 2)}`);
    
    // Make the request
    const response = await axios.post(
      config.WHISPR_BASE_URL,
      requestData,
      {
        headers: {
          'X-HMAC-SIGNATURE': hmac,
          'X-TIMESTAMP': timestamp,
          'Content-Type': 'application/json'
        },
        timeout: config.HTTP_TIMEOUT,
        validateStatus: () => true
      }
    );
    
    // Analyze response
    if (response.status >= 200 && response.status < 300) {
      success(`API request successful (${response.status})`);
      if (response.data.paymentHash) {
        success(`Received payment hash: ${response.data.paymentHash}`);
        return { success: true, paymentHash: response.data.paymentHash, response };
      } else {
        warn('API request succeeded but no payment hash received');
        return { success: false, response };
      }
    } else {
      error(`API request failed with status: ${response.status}`);
      debug(`Response data: ${JSON.stringify(response.data, null, 2)}`);
      return { success: false, status: response.status, data: response.data, response };
    }
  } catch (err) {
    error(`Request error: ${err.message}`);
    if (err.response) {
      debug(`Response status: ${err.response.status}`);
      debug(`Response data: ${JSON.stringify(err.response.data, null, 2)}`);
      return { success: false, error: err, responseData: err.response.data };
    }
    return { success: false, error: err };
  }
}

/**
 * Poll for transcript result
 */
async function pollForResult(paymentHash, maxAttempts = 5) {
  info(`Polling for results with payment hash: ${paymentHash}`);
  
  let attempt = 0;
  let delay = 5000;
  
  while (attempt < maxAttempts) {
    attempt++;
    info(`Polling attempt ${attempt}/${maxAttempts}, waiting ${delay/1000}s...`);
    
    // Wait before polling
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Create HMAC
    const timestamp = String(Date.now());
    const hmac = crypto.createHmac('sha256', config.SHARED_SECRET)
      .update(timestamp)
      .digest('hex');
    
    try {
      // Make poll request
      const response = await axios.get(
        `${config.WHISPR_BASE_URL}/${paymentHash}/get_result`,
        {
          headers: {
            'X-HMAC-SIGNATURE': hmac,
            'X-TIMESTAMP': timestamp
          },
          timeout: config.HTTP_TIMEOUT,
          validateStatus: () => true
        }
      );
      
      // Check response
      if (response.status === 200 && response.data && response.data.channels) {
        success(`Received transcript successfully!`);
        return { success: true, transcript: response.data };
      } else if (response.status === 404 || response.status === 202) {
        debug(`Status ${response.status}: Transcript not ready yet`);
      } else {
        warn(`Unexpected status ${response.status}: ${JSON.stringify(response.data, null, 2)}`);
      }
    } catch (err) {
      warn(`Polling error: ${err.message}`);
    }
    
    // Increase delay for next attempt
    delay = Math.min(delay * 1.5, 30000);
  }
  
  return { success: false, error: 'Max polling attempts reached' };
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
      section('Whispr Service URL Tester');
      log('Usage: node url-tester.js <url-to-test> [options]');
      log('\nOptions:');
      log('  --verbose          Show verbose output');
      log('  --simulate-client  Simulate client request format');
      log('  --timeout=<ms>     Set HTTP timeout in milliseconds (default: 30000)');
      return;
    }
    
    // Extract URL and options
    const url = args[0];
    
    // Process options
    config.VERBOSE = args.includes('--verbose');
    config.SIMULATE_CLIENT = args.includes('--simulate-client');
    
    // Find timeout option if specified
    const timeoutArg = args.find(arg => arg.startsWith('--timeout='));
    if (timeoutArg) {
      const timeout = parseInt(timeoutArg.split('=')[1], 10);
      if (!isNaN(timeout) && timeout > 0) {
        config.HTTP_TIMEOUT = timeout;
        debug(`HTTP timeout set to ${timeout}ms`);
      }
    }
    
    section('URL Analysis');
    
    // Basic URL validation
    info(`Analyzing URL: ${url}`);
    
    const urlAnalysis = analyzeUrl(url);
    
    if (urlAnalysis.error) {
      error(urlAnalysis.error);
      process.exit(1);
    }
    
    debug(`Protocol: ${urlAnalysis.protocol}`);
    debug(`Hostname: ${urlAnalysis.hostname}`);
    debug(`Path: ${urlAnalysis.pathname}`);
    debug(`Extension: ${urlAnalysis.extension || 'none'}`);
    
    // Report URL issues
    if (urlAnalysis.issues.length > 0) {
      warn(`Found ${urlAnalysis.issues.length} potential URL issues:`);
      urlAnalysis.issues.forEach((issue, i) => {
        warn(`${i + 1}. ${issue}`);
      });
    } else {
      success('URL format looks valid');
    }
    
    section('URL Validation');
    
    // Check if URL resolves and get content type
    info('Checking URL headers...');
    const urlValidation = await validateUrl(url);
    
    if (urlValidation.isValid) {
      success(`URL is accessible (Status ${urlValidation.status})`);
      
      if (urlValidation.contentType) {
        if (urlValidation.isAudio) {
          success(`Content-Type indicates audio: ${urlValidation.contentType}`);
        } else {
          warn(`Content-Type might not be audio: ${urlValidation.contentType}`);
        }
      }
      
      if (urlValidation.contentLength) {
        const sizeMB = parseInt(urlValidation.contentLength, 10) / (1024 * 1024);
        if (sizeMB > 0) {
          if (sizeMB > 100) {
            warn(`File is large: ${sizeMB.toFixed(2)}MB. This may cause timeout issues.`);
          } else {
            success(`File size: ${sizeMB.toFixed(2)}MB`);
          }
        }
      }
    } else {
      error(`URL validation failed: ${urlValidation.error || 'Unknown error'}`);
      if (urlValidation.isTimeout) {
        warn('Request timed out. The server may be slow or the file may be too large.');
      }
    }
    
    // Check for redirects
    info('Checking for redirects...');
    const redirectInfo = await followRedirects(url);
    
    if (redirectInfo.error) {
      warn(`Error following redirects: ${redirectInfo.error}`);
    } else if (redirectInfo.redirectCount > 0) {
      if (redirectInfo.tooManyRedirects) {
        warn(`Too many redirects (${redirectInfo.redirectCount})`);
      } else {
        info(`URL redirects ${redirectInfo.redirectCount} times`);
        info(`Final URL: ${redirectInfo.finalUrl}`);
        
        if (redirectInfo.finalUrl !== url) {
          warn('The URL redirects. Consider using the final URL directly.');
        }
      }
    } else {
      success('URL does not redirect');
    }
    
    section('Whispr Service API Test');
    
    // Test with Whispr API
    const apiTest = await testUrlWithWhispr(url);
    
    // If successful and we got a payment hash, poll for results
    if (apiTest.success && apiTest.paymentHash) {
      section('Result Polling');
      await pollForResult(apiTest.paymentHash);
    }
    
  } catch (err) {
    error(`Unhandled error: ${err.message}`);
    console.error(err);
  }
}

// Run main function
main(); 