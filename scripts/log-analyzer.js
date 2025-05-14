#!/usr/bin/env node

/**
 * Whispr Service Log Analyzer
 * 
 * This script helps analyze logs to find and debug 400 errors
 * and other issues in the Whispr transcription service.
 * 
 * Usage:
 * 1. Save logs to a file: `node your-app.js > app.log 2>&1`
 * 2. Run analyzer: `node log-analyzer.js app.log`
 */

const fs = require('fs');
const path = require('path');

// Patterns to look for
const ERROR_PATTERNS = {
  HTTP_400: /(HTTP.*400|status code 400|Request failed with status code 400)/i,
  URL_VALIDATION: /\[WHISPR-ERROR\] URL validation failed/i,
  DEEPGRAM_ERROR: /\[WHISPR-ERROR\] Deepgram transcription error/i,
  FILE_NOT_FOUND: /Error: Audio file not found or inaccessible/i,
  PERMISSION_ERROR: /(EACCES|permission denied)/i,
  NETWORK_ERROR: /(ECONNRESET|ETIMEDOUT|ECONNREFUSED)/i,
  DATABASE_ERROR: /(MongooseError|MongoDB|mongoose)/i,
  FILE_ACCESS_ERROR: /(ENOENT|no such file or directory)/i
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

// Context window - number of lines before and after an error to display
const CONTEXT_LINES = 10;

/**
 * Print a message with color
 */
function colorPrint(message, color) {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Parse a log file and extract relevant information
 */
function parseLogFile(filePath) {
  try {
    // Read the log file
    const logContent = fs.readFileSync(filePath, 'utf8');
    const lines = logContent.split('\n');
    
    // Extract timestamps, log level, and messages
    const parsedLogs = [];
    let lineNumber = 0;
    
    for (const line of lines) {
      lineNumber++;
      // Skip empty lines
      if (!line.trim()) continue;
      
      // Find any errors based on patterns
      const matchedErrors = Object.entries(ERROR_PATTERNS)
        .filter(([_, pattern]) => pattern.test(line))
        .map(([errorType]) => errorType);
      
      parsedLogs.push({
        lineNumber,
        line,
        hasError: matchedErrors.length > 0,
        errorTypes: matchedErrors
      });
    }
    
    return parsedLogs;
  } catch (error) {
    colorPrint(`Error parsing log file: ${error.message}`, colors.red);
    process.exit(1);
  }
}

/**
 * Print errors with context
 */
function printErrorsWithContext(parsedLogs) {
  const errors = parsedLogs.filter(log => log.hasError);
  
  if (errors.length === 0) {
    colorPrint('No errors found in the log file!', colors.green);
    return;
  }
  
  colorPrint(`Found ${errors.length} errors in the log file`, colors.yellow);
  
  // Group errors by type for summary
  const errorsByType = {};
  for (const error of errors) {
    for (const errorType of error.errorTypes) {
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
    }
  }
  
  // Print error summary
  colorPrint('\nError summary:', colors.bold);
  for (const [errorType, count] of Object.entries(errorsByType)) {
    console.log(`${errorType}: ${count} occurrences`);
  }
  
  // Print detailed errors with context
  colorPrint('\nDetailed errors with context:', colors.bold);
  
  const processedLines = new Set();
  
  for (const error of errors) {
    // Skip if we've already processed this line as part of another error's context
    if (processedLines.has(error.lineNumber)) continue;
    
    colorPrint(`\n${'='.repeat(80)}`, colors.yellow);
    colorPrint(`Error at line ${error.lineNumber}: ${error.errorTypes.join(', ')}`, colors.red);
    colorPrint(`${'='.repeat(80)}`, colors.yellow);
    
    // Print context before error
    const startLine = Math.max(1, error.lineNumber - CONTEXT_LINES);
    const endLine = Math.min(parsedLogs.length, error.lineNumber + CONTEXT_LINES);
    
    for (let i = startLine - 1; i < endLine; i++) {
      if (i < 0 || i >= parsedLogs.length) continue;
      
      const log = parsedLogs[i];
      processedLines.add(log.lineNumber);
      
      const linePrefix = log.lineNumber === error.lineNumber ? '> ' : '  ';
      const lineColor = log.lineNumber === error.lineNumber ? colors.red : (log.hasError ? colors.yellow : colors.reset);
      
      console.log(`${linePrefix}${log.lineNumber}: ${lineColor}${log.line}${colors.reset}`);
    }
  }
  
  // Print potential solutions
  printPotentialSolutions(errorsByType);
}

/**
 * Print potential solutions based on error types
 */
function printPotentialSolutions(errorsByType) {
  colorPrint('\nPotential solutions:', colors.bold);
  
  if (errorsByType.HTTP_400) {
    colorPrint('\nFor 400 Bad Request errors:', colors.cyan);
    console.log('1. Check that the request format/data is correct');
    console.log('2. Validate that the URL is accessible and contains audio content');
    console.log('3. Ensure the URL doesn\'t have special characters that need encoding');
    console.log('4. If it\'s a redirect URL, follow it manually to find the final destination');
    console.log('5. Try downloading the file locally to see if it\'s valid');
  }
  
  if (errorsByType.URL_VALIDATION) {
    colorPrint('\nFor URL validation failures:', colors.cyan);
    console.log('1. Ensure the URL is accessible (try opening it in a browser)');
    console.log('2. Check if the URL requires authentication or has access restrictions');
    console.log('3. Verify that the URL points to a valid audio file format');
    console.log('4. If the URL has redirects, try using the final URL directly');
  }
  
  if (errorsByType.DEEPGRAM_ERROR) {
    colorPrint('\nFor Deepgram API errors:', colors.cyan);
    console.log('1. Verify your Deepgram API key is valid and has sufficient credits');
    console.log('2. Check if the audio format is supported by Deepgram');
    console.log('3. Make sure the audio duration isn\'t too long (>2 hours)');
    console.log('4. Ensure the API key has the necessary permissions');
  }
  
  if (errorsByType.FILE_NOT_FOUND || errorsByType.FILE_ACCESS_ERROR) {
    colorPrint('\nFor file access errors:', colors.cyan);
    console.log('1. Check if the file paths are correct');
    console.log('2. Ensure temporary directories exist and have proper permissions');
    console.log('3. Verify that disk space is sufficient');
    console.log('4. Check if file was deleted before processing completed');
  }
  
  if (errorsByType.DATABASE_ERROR) {
    colorPrint('\nFor database errors:', colors.cyan);
    console.log('1. Ensure MongoDB connection string is correct');
    console.log('2. Check if MongoDB service is running');
    console.log('3. Verify database credentials');
    console.log('4. Check for MongoDB timeouts or connection limits');
  }
  
  if (errorsByType.NETWORK_ERROR) {
    colorPrint('\nFor network errors:', colors.cyan);
    console.log('1. Check your internet connection');
    console.log('2. Verify that all required services are running');
    console.log('3. Check if there are any firewall or network restrictions');
    console.log('4. Increase network timeouts for large files');
  }
}

/**
 * Check URL for potential issues
 */
function analyzeUrl(url) {
  try {
    const parsed = new URL(url);
    const issues = [];
    
    // Check for common issues
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      issues.push('URL uses an unsupported protocol. Only http and https are supported.');
    }
    
    if (parsed.search && parsed.search.includes('?')) {
      issues.push('URL contains query parameters which might need proper encoding.');
    }
    
    if (parsed.hash) {
      issues.push('URL contains a hash fragment which might not be handled correctly.');
    }
    
    // Check for well-known problematic domains or patterns
    if (parsed.hostname.includes('localhost')) {
      issues.push('URL points to localhost which is not accessible from the server.');
    }
    
    if (parsed.hostname.includes('192.168.') || parsed.hostname.includes('10.0.')) {
      issues.push('URL points to a private IP address which is not accessible from the internet.');
    }
    
    return { parsed, issues };
  } catch (error) {
    return { parsed: null, issues: [`Invalid URL: ${error.message}`] };
  }
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    colorPrint('Please provide a log file path as an argument', colors.red);
    colorPrint('Usage: node log-analyzer.js <log-file-path>', colors.yellow);
    process.exit(1);
  }
  
  const logFilePath = args[0];
  
  // Check if file exists
  if (!fs.existsSync(logFilePath)) {
    colorPrint(`Log file not found: ${logFilePath}`, colors.red);
    process.exit(1);
  }
  
  colorPrint(`Analyzing log file: ${logFilePath}`, colors.blue);
  
  const parsedLogs = parseLogFile(logFilePath);
  printErrorsWithContext(parsedLogs);
  
  // If URL is provided as second argument, analyze it
  if (args[1] && args[1].startsWith('http')) {
    colorPrint('\nAnalyzing provided URL:', colors.bold);
    const urlAnalysis = analyzeUrl(args[1]);
    
    if (urlAnalysis.parsed) {
      console.log(`Parsed URL: ${args[1]}`);
      console.log(`Protocol: ${urlAnalysis.parsed.protocol}`);
      console.log(`Hostname: ${urlAnalysis.parsed.hostname}`);
      console.log(`Path: ${urlAnalysis.parsed.pathname}`);
      console.log(`Extension: ${path.extname(urlAnalysis.parsed.pathname)}`);
      
      if (urlAnalysis.issues.length > 0) {
        colorPrint('\nPotential URL issues:', colors.yellow);
        urlAnalysis.issues.forEach((issue, i) => {
          console.log(`${i + 1}. ${issue}`);
        });
      } else {
        colorPrint('No obvious issues found with URL format.', colors.green);
      }
    } else {
      colorPrint(`URL analysis failed: ${urlAnalysis.issues[0]}`, colors.red);
    }
  }
  
  colorPrint('\nLog analysis complete!', colors.green);
}

// Run the main function
main(); 