const mongoose = require('mongoose');
const typeEnum = ['rss transcript', 'rss analysis']; // Add other types as needed


const WorkProductSchema = new mongoose.Schema({
    type:typeEnum,
    result: Object,
    lookupHash:String //calculated based on the inputs, possible even outputs
});
  
module.exports = mongoose.model("WorkProduct", WorkProductSchema);