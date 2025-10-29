const mongoose = require('mongoose');

const JobRequestSchema = new mongoose.Schema({
    invoice: Object,
    paymentHash: String,
    verifyURL: String,
    status: String,
    result: String,
    price: Number,
    requestData: Object,
    requestResponse: Object,
    service: String,
    state: String,
});

// Add indexes for performance
JobRequestSchema.index({ paymentHash: 1 });
JobRequestSchema.index({ 'requestData.guid': 1 });
JobRequestSchema.index({ service: 1 });
JobRequestSchema.index({ state: 1 });
  
module.exports = mongoose.model("JobRequest", JobRequestSchema);