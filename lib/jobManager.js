const { findJobRequestByPaymentHash } = require('./nip105');
const { submitService } = require('./service');
const path = require('path');
const { TEMP_DIR } = require('./fileManagement');
const JobRequest = require('../models/jobRequest');

class JobManager {
    constructor() {
        // Queue of jobs with paymentHash as key
        this.jobQueue = [];
        
        // Map to quickly find jobs by paymentHash
        this.jobMap = new Map();
        
        // Flag to track if the queue processor is running
        this.isProcessing = false;
        
        // Maximum number of retries for a job
        this.maxRetries = 3;
        
        // Maximum number of concurrent jobs
        this.maxConcurrentJobs = 2;
        
        // Currently processing jobs
        this.processingJobs = new Set();
        
        // Initialize the job manager
        this.initialize();
    }
    
    /**
     * Initialize the job manager by loading existing jobs from MongoDB
     */
    async initialize() {
        try {
            console.log('Initializing JobManager...');
            
            // First load existing jobs from MongoDB
            await this.loadExistingJobs();
            
            // Then start the queue processor
            this.startQueueProcessor();
            
            console.log(`JobManager initialized with ${this.jobQueue.length} jobs in queue`);
        } catch (error) {
            console.error('Error initializing JobManager:', error);
        }
    }
    
    /**
     * Load existing jobs from MongoDB
     */
    async loadExistingJobs() {
        try {
            // Find all job requests in the WORKING state
            const workingJobs = await JobRequest.find({ state: 'WORKING' }).exec();
            console.log(`Found ${workingJobs.length} jobs in WORKING state`);
            
            // Add each job to the queue
            for (const job of workingJobs) {
                this.addJob(job.paymentHash, job.service);
            }
        } catch (error) {
            console.error('Error loading existing jobs:', error);
        }
    }
    
    /**
     * Add a job to the queue
     * @param {String} paymentHash - The payment hash of the job
     * @param {String} service - The service type (e.g., WHSPR)
     * @returns {Object} - Job info with position
     */
    addJob(paymentHash, service) {
        // Check if job already exists in queue
        if (this.jobMap.has(paymentHash)) {
            return this.getJobInfo(paymentHash);
        }
        
        // Create a new job
        const job = {
            paymentHash,
            service,
            status: 'QUEUED',
            queuedAt: new Date(),
            startedAt: null,
            completedAt: null,
            attempts: 0,
            error: null
        };
        
        // Add to queue and map
        this.jobQueue.push(job);
        this.jobMap.set(paymentHash, job);
        
        console.log(`Job ${paymentHash} added to queue at position ${this.jobQueue.length}`);
        
        // Trigger queue processor if it's not already running
        if (!this.isProcessing) {
            this.processNextJobs();
        }
        
        return this.getJobInfo(paymentHash);
    }
    
    /**
     * Get information about a job
     * @param {String} paymentHash - The payment hash of the job
     * @returns {Object} - Job information including queue position
     */
    getJobInfo(paymentHash) {
        const job = this.jobMap.get(paymentHash);
        if (!job) {
            return null;
        }
        
        // Calculate queue position (only relevant for queued jobs)
        let queuePosition = null;
        if (job.status === 'QUEUED') {
            queuePosition = this.jobQueue.findIndex(j => j.paymentHash === paymentHash) + 1;
        }
        
        return {
            ...job,
            queuePosition
        };
    }
    
    /**
     * Start the queue processor
     */
    startQueueProcessor() {
        // Set interval to check queue every 5 seconds
        setInterval(() => {
            if (this.jobQueue.length > 0 && !this.isProcessing) {
                this.processNextJobs();
            }
        }, 5000);
        
        console.log('Job queue processor started');
    }
    
    /**
     * Process the next jobs in the queue
     */
    async processNextJobs() {
        if (this.isProcessing || this.jobQueue.length === 0) {
            return;
        }
        
        // Mark as processing
        this.isProcessing = true;
        
        try {
            // Process jobs until queue is empty or max concurrent jobs reached
            while (this.jobQueue.length > 0 && this.processingJobs.size < this.maxConcurrentJobs) {
                // Get the next job
                const job = this.jobQueue.shift();
                
                // Skip if job is already being processed
                if (this.processingJobs.has(job.paymentHash)) {
                    continue;
                }
                
                // Add to processing set
                this.processingJobs.add(job.paymentHash);
                
                // Update job status
                job.status = 'PROCESSING';
                job.startedAt = new Date();
                job.attempts++;
                
                // Process job in background
                this.processJob(job).catch(err => {
                    console.error(`Error processing job ${job.paymentHash}:`, err);
                });
            }
        } finally {
            // Reset processing flag if queue is empty or max concurrent jobs reached
            if (this.jobQueue.length === 0 || this.processingJobs.size >= this.maxConcurrentJobs) {
                this.isProcessing = false;
            }
        }
    }
    
    /**
     * Process a single job
     * @param {Object} job - The job to process
     */
    async processJob(job) {
        console.log(`🔧 Processing job ${job.paymentHash}`);
        
        try {
            // Get the job request from MongoDB
            const doc = await findJobRequestByPaymentHash(job.paymentHash);
            console.log(`📋 Job data for ${job.paymentHash}:`, JSON.stringify(doc.requestData, null, 2));
            
            // Set job state to WORKING in MongoDB
            doc.state = 'WORKING';
            await doc.save();
            
            // Get the data needed to process the job
            const data = doc.requestData;
            
            // Calculate full path for the audio file
            const fullPath = path.join(TEMP_DIR, data.filePath);
            console.log(`📁 Full file path: ${fullPath}`);
            
            // Check if file exists
            const fs = require('fs');
            if (!fs.existsSync(fullPath)) {
                throw new Error(`Audio file not found at path: ${fullPath}`);
            }
            console.log(`✅ File exists at: ${fullPath}`);
            
            // Call the service to process the job
            console.log(`🚀 Calling submitService for ${job.service}...`);
            console.log(`🚀 Input data being sent to submitService:`, JSON.stringify({ ...data, filePath: fullPath }, null, 2));
            const response = await submitService(job.service, { ...data, filePath: fullPath });
            console.log(`✅ submitService returned successfully`);
            console.log(`📊 Response type: ${typeof response}`);
            console.log(`📊 Response is Array: ${Array.isArray(response)}`);
            console.log(`📊 Response is null: ${response === null}`);
            console.log(`📊 Response is undefined: ${response === undefined}`);
            console.log(`📊 Response constructor: ${response ? response.constructor.name : 'none'}`);
            console.log(`📊 Response keys: ${response ? Object.keys(response).join(', ') : 'none'}`);
            console.log(`🔍🔍🔍 FULL RESPONSE OBJECT (ENTIRE THING):`);
            console.log(JSON.stringify(response, null, 2));
            console.log(`🔍🔍🔍 END FULL RESPONSE`);
            
            // Also log it with util.inspect for non-JSON-serializable stuff
            const util = require('util');
            console.log(`🔍🔍🔍 FULL RESPONSE WITH UTIL.INSPECT:`);
            console.log(util.inspect(response, { depth: 10, colors: false, maxArrayLength: null }));
            console.log(`🔍🔍🔍 END UTIL.INSPECT`);
            
            // Check if it's an error object
            if (response instanceof Error) {
                console.error(`❌❌❌ RESPONSE IS AN ERROR OBJECT!`);
                console.error(`Error name: ${response.name}`);
                console.error(`Error message: ${response.message}`);
                console.error(`Error stack: ${response.stack}`);
            }
            
            // Log a preview of the transcript if available
            if (response && response.channels && response.channels.length > 0) {
                try {
                    const transcript = response.channels[0].alternatives[0].transcript;
                    console.log(`✅ JOB ${job.paymentHash} TRANSCRIPT PREVIEW: ${transcript.substring(0, 200)}...`);
                } catch (e) {
                    console.log(`⚠️  Could not extract transcript preview from job result: ${e.message}`);
                }
            } else {
                console.warn(`⚠️  No transcript found in job response for ${job.paymentHash}`);
                console.log(`Response type: ${typeof response}`);
                console.log(`Response keys: ${response ? Object.keys(response).join(', ') : 'none'}`);
                if (response) {
                    console.log(`Attempting to access response.channels:`, response.channels);
                    console.log(`Attempting to access response.results:`, response.results);
                    console.log(`Attempting to access response.data:`, response.data);
                }
            }
            
            // Update job in MongoDB with results
            doc.requestResponse = response;
            doc.state = 'DONE';
            await doc.save();
            
            console.log(`✅ Job ${job.paymentHash} completed successfully`);
            
            // Update job in memory
            job.status = 'COMPLETED';
            job.completedAt = new Date();
        } catch (error) {
            console.error(`❌ Error processing job ${job.paymentHash}:`, error);
            console.error(`❌ Error stack:`, error.stack);
            console.error(`❌ Error message:`, error.message);
            console.error(`❌ Error type:`, error.constructor.name);
            
            // Get the job request from MongoDB
            try {
                const doc = await findJobRequestByPaymentHash(job.paymentHash);
                
                // Check if max retries reached
                if (job.attempts >= this.maxRetries) {
                    console.error(`❌ Max retries (${this.maxRetries}) reached for job ${job.paymentHash}`);
                    // Update job in MongoDB with error
                    doc.requestResponse = error;
                    doc.state = 'ERROR';
                    await doc.save();
                    
                    // Update job in memory
                    job.status = 'FAILED';
                    job.completedAt = new Date();
                    job.error = error.message || 'Unknown error';
                } else {
                    console.log(`🔄 Re-queuing job ${job.paymentHash} for retry (attempt ${job.attempts}/${this.maxRetries})`);
                    // Re-queue the job for retry
                    doc.state = 'QUEUED';
                    await doc.save();
                    
                    // Add back to queue
                    this.jobQueue.push(job);
                    job.status = 'QUEUED';
                }
            } catch (dbError) {
                console.error(`❌ Error updating job ${job.paymentHash} in database:`, dbError);
                job.status = 'FAILED';
                job.completedAt = new Date();
                job.error = 'Database error: ' + dbError.message;
            }
        } finally {
            // Remove from processing set
            this.processingJobs.delete(job.paymentHash);
            
            // Continue processing queue if there are more jobs
            if (this.jobQueue.length > 0 && this.processingJobs.size < this.maxConcurrentJobs) {
                this.processNextJobs();
            } else {
                this.isProcessing = false;
            }
        }
    }
    
    /**
     * Remove a job from the queue
     * @param {String} paymentHash - The payment hash of the job to remove
     */
    removeJob(paymentHash) {
        // Remove from processing set if present
        this.processingJobs.delete(paymentHash);
        
        // Remove from queue if present
        const index = this.jobQueue.findIndex(job => job.paymentHash === paymentHash);
        if (index !== -1) {
            this.jobQueue.splice(index, 1);
        }
        
        // Remove from map
        this.jobMap.delete(paymentHash);
    }
    
    /**
     * Get the number of jobs in the queue
     * @returns {Number} - The number of jobs in the queue
     */
    getQueueSize() {
        return this.jobQueue.length;
    }
    
    /**
     * Get the number of jobs currently processing
     * @returns {Number} - The number of jobs currently processing
     */
    getProcessingCount() {
        return this.processingJobs.size;
    }
}

// Create a singleton instance
const jobManager = new JobManager();

module.exports = jobManager; 