#!/usr/bin/env node

// Quick script to clear stuck jobs
require('dotenv').config();
const mongoose = require('mongoose');
const JobRequest = require('./models/jobRequest');

const guid = process.argv[2] || '180446819876543210fedcba9876543210fedcba';

async function clearJob() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`Connected to MongoDB`);
        
        // Find and delete the job
        const result = await JobRequest.deleteOne({'requestData.guid': guid});
        console.log(`Deleted ${result.deletedCount} job(s) with GUID: ${guid}`);
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

clearJob();

