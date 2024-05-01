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
  
module.exports = mongoose.model("JobRequest", JobRequestSchema);