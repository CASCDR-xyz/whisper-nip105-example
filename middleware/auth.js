const { validatePreimage, validateCascdrUserEligibility } = require('../lib/authChecks');
const crypto = require('crypto');

const EndpointRequestedTypes = {
    CREATE_JOB: 0,
    GET_RESULT: 1,
    // Placeholder for future development
};

const auth = async (req, res, next) => {
    console.log("auth middleware running...")
    try{
        const authHeader = req.headers?.authorization;
        const paymentHash = req.params?.payment_hash;
        // check the preimage first
        const preimage = (authHeader && authHeader[0] === ':') ? authHeader.substring(1) : false;
        let preimageAllowed = false;
        if (preimage) {
            preimageAllowed = validatePreimage(preimage, req.params?.payment_hash);
        }
    
        if (preimageAllowed) {
            req.body.authAllowed = true;
            req.body.authCategory = 1;
            console.log("got valid preimage")
            next();
            return
        }
    
        // next check the HMAC
        const SHARED_SECRET = process.env.SHARED_HMAC_SECRET; 
        const receivedHmac = req.headers['x-hmac-signature'];
        const receivedTimestamp = req.headers['x-timestamp'] ? req.headers['x-timestamp'] : "no timestamp header";
        const hmac = crypto.createHmac('sha256', SHARED_SECRET).update(receivedTimestamp).digest('hex');
    
        console.log("hmac:",hmac)
        console.log("receivedHmac:",receivedHmac)
    
        if (receivedHmac === hmac) {
            req.body.authAllowed = true;
            req.body.authCategory = 0;
            console.log("receivedHmac!")
            next();
            return;
        }
        
        // finally, check the user eligibility
        const token = (authHeader && authHeader.split(':')[0] === 'Bearer') ? authHeader.split(' ')[1] : false;
        const reqIPAddress = req.ip;
        const requestedService = req.params.service
        let userEligible = {};
        console.log("authHeader:",authHeader)
        console.log("token:",token)
        if (token) {
            // assign based on get or post
            const endpointRequested = req.method === 'GET' ? EndpointRequestedTypes.GET_RESULT : EndpointRequestedTypes.CREATE_JOB;
            userEligible = await validateCascdrUserEligibility(token, reqIPAddress, requestedService, endpointRequested);
        }
        console.log("userEligible map result:", userEligible)
        if(userEligible?.hasFreeTrial){
            req.body.authAllowed = true;
            req.body.authCategory = 0;
            console.log("got free trial!")
            next();
            return;
        }
        else if (userEligible?.hasValidSubscription) {
            req.body.authAllowed = true;
            req.body.authCategory = 1;
            console.log("got valid sub!")
            next();
            return;
        }
    
        // if none of the above checks pass, authAllowed is false so default to Lightning invoice
        req.body.authAllowed = false;
        req.body.authCategory = 2;
        console.log("falling back to LN")
        next();
        return;
    }
    catch(e){
        console.log("error in auth middleware:",e)
        console.log("falling back to LN")
        req.body.authAllowed = false;
        req.body.authCategory = 2;
        next();
        return;
    }
}

module.exports = auth;