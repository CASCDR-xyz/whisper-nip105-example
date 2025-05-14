const asyncHandler = require('../middleware/async');
const crypto = require('crypto');
const { getServicePrice, submitService } = require('../lib/service');
const { createNewJobDocument, findJobRequestByPaymentHash, getIsInvoicePaid, generateInvoice } = require('../lib/nip105');
const { logState, sleep } = require('../lib/common');
const musicMetadata = require('music-metadata');
const {
    upload,
    extractAudioFromMp4,
    extractAudioFromVideo,
    downloadRemoteFile,
    validateAudioSize,
    getAudioDuration,
    convertToMp3,
    getRemoteFileSize,
    FILE_SIZE_LIMIT_MB
} = require('../lib/fileManagement');
const path = require('path');
const { TEMP_DIR } = require('../lib/fileManagement');
const jobManager = require('../lib/jobManager');

const ALLOWED_AUDIO_FORMATS = ['.mp3', '.wav', '.ogg', '.flac', '.m4a'];
const ALLOWED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.webm'];

function isAllowedFormat(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_AUDIO_FORMATS.includes(ext) || ALLOWED_VIDEO_FORMATS.includes(ext);
}

exports.postService = asyncHandler(async (req, res, next) => {
    const authAllowed = req.body?.authAllowed;
    console.log(`postService req.body:`, JSON.stringify(req.body, null, 2));
    const service = req.params.service;

    if (authAllowed) {
        const fakePaymentHash = crypto.randomBytes(20).toString('hex');
        const price = await getServicePrice(service, 10);
        const fakeInvoice = { verify: "fakeURL", pr: "fakePaymentRequest", paymentHash: fakePaymentHash };
        await createNewJobDocument(service, fakeInvoice, fakePaymentHash, price);
        const doc = await findJobRequestByPaymentHash(fakePaymentHash);
        doc.status = "PAID";
        doc.state = "NOT_PAID";
        doc.requestData = req.body;
        if (req?.file?.path) {
            doc.requestData["filePath"] = path.basename(req.file.path);
            await doc.save();
        } else {
            const remoteUrl = req.body?.remote_url;
            if (remoteUrl) {
                const urlObj = new URL(remoteUrl);
                if (!isAllowedFormat(urlObj.pathname)) {
                    return res.status(400).send('Invalid file format. Supported formats: ' + 
                        ALLOWED_AUDIO_FORMATS.concat(ALLOWED_VIDEO_FORMATS).join(', '));
                }
                
                const fileSizeInfo = await getRemoteFileSize(remoteUrl);
                if (fileSizeInfo && fileSizeInfo.mb > FILE_SIZE_LIMIT_MB) {
                    return res.status(400).send(`File is too large to transcribe. The limit is ${FILE_SIZE_LIMIT_MB}MB, but the file is ${fileSizeInfo.mb.toFixed(2)}MB.`);
                }
                
                const downloadedFilePath = await downloadRemoteFile(remoteUrl);
                let audioFilePath = downloadedFilePath;
                const fileExtension = path.extname(downloadedFilePath).toLowerCase();

                if (ALLOWED_VIDEO_FORMATS.includes(fileExtension)) {
                    audioFilePath = downloadedFilePath.replace(fileExtension, '.mp3');
                    await extractAudioFromVideo(downloadedFilePath, audioFilePath);
                } else if (ALLOWED_AUDIO_FORMATS.includes(fileExtension) && fileExtension !== '.mp3') {
                    audioFilePath = downloadedFilePath.replace(fileExtension, '.mp3');
                    await convertToMp3(downloadedFilePath, audioFilePath);
                }

                const isValidSize = await validateAudioSize(audioFilePath);
                if (!isValidSize) {
                    return res.status(400).send(`File is too large to transcribe. The limit is ${FILE_SIZE_LIMIT_MB}MB.`);
                }

                const durationInSeconds = await getAudioDuration(audioFilePath);
                const invoice = await generateInvoice(service, durationInSeconds);
                doc.requestData["remote_url"] = remoteUrl;
                doc.requestData["filePath"] = path.basename(audioFilePath);
            }
            await doc.save();
        }
        const successAction = {
            tag: "url",
            url: `${process.env.ENDPOINT}/${service}/${fakePaymentHash}/get_result`,
            description: "Open to get the confirmation code for your purchase."
        };
        res.status(200).send({paymentHash: fakePaymentHash, authCategory: req.body.authCategory, successAction});
        return;
    }

    try {
        let audioFilePath;
        let originalFilePath;

        if (req.body.remote_url) {
            const remoteUrl = req.body.remote_url;
            const urlObj = new URL(remoteUrl);
            
            if (!isAllowedFormat(urlObj.pathname)) {
                return res.status(400).send('Invalid file format. Supported formats: ' + 
                    ALLOWED_AUDIO_FORMATS.concat(ALLOWED_VIDEO_FORMATS).join(', '));
            }

            const fileSizeInfo = await getRemoteFileSize(remoteUrl);
            if (fileSizeInfo && fileSizeInfo.mb > FILE_SIZE_LIMIT_MB) {
                return res.status(400).send(`File is too large to transcribe. The limit is ${FILE_SIZE_LIMIT_MB}MB, but the file is ${fileSizeInfo.mb.toFixed(2)}MB.`);
            }

            originalFilePath = await downloadRemoteFile(remoteUrl);
        } else if (req.file) {
            if (!isAllowedFormat(req.file.originalname)) {
                return res.status(400).send('Invalid file format. Supported formats: ' + 
                    ALLOWED_AUDIO_FORMATS.concat(ALLOWED_VIDEO_FORMATS).join(', '));
            }
            originalFilePath = req.file.path;
        } else {
            return res.status(400).send('No file uploaded or remote URL provided.');
        }

        const fileExtension = path.extname(originalFilePath).toLowerCase();

        if (ALLOWED_VIDEO_FORMATS.includes(fileExtension)) {
            audioFilePath = originalFilePath.replace(fileExtension, '.mp3');
            await extractAudioFromVideo(originalFilePath, audioFilePath);
        } else if (ALLOWED_AUDIO_FORMATS.includes(fileExtension) && fileExtension !== '.mp3') {
            audioFilePath = originalFilePath.replace(fileExtension, '.mp3');
            await convertToMp3(originalFilePath, audioFilePath);
        } else {
            audioFilePath = originalFilePath;
        }

        const isValidSize = await validateAudioSize(audioFilePath);
        if (!isValidSize) {
            return res.status(400).send(`File is too large to transcribe. The limit is ${FILE_SIZE_LIMIT_MB}MB.`);
        }

        const durationInSeconds = await getAudioDuration(audioFilePath);
        const invoice = await generateInvoice(service, durationInSeconds);

        const successAction = {
            tag: "url",
            url: `${process.env.ENDPOINT}/${service}/${invoice.paymentHash}/get_result`,
            description: "Open to get the confirmation code for your purchase."
        };

        const doc = await findJobRequestByPaymentHash(invoice.paymentHash);
        doc.requestData = req.body;
        doc.requestData["filePath"] = path.basename(audioFilePath);
        if (req.body.remote_url) {
            doc.requestData["remote_url"] = req.body.remote_url;
        }
        doc.state = "NOT_PAID";
        await doc.save();

        logState(service, invoice.paymentHash, "REQUESTED");
        res.status(402).send({...invoice, authCategory: req.body.authCategory, successAction});

    } catch (e) {
        console.log(e.toString().substring(0, 150));
        res.status(500).send(e);
    }
});

exports.checkPayment = asyncHandler(async (req,res,next) =>{
    try {
        const paymentHash = req.params.payment_hash;
        const { isPaid, invoice } = await getIsInvoicePaid(paymentHash);

        res.status(200).json({ invoice, isPaid });
    } catch (e) {
        console.log(e.toString().substring(0, 50));
        res.status(500).send(e);
    }
});

exports.getResult = asyncHandler(async (req,res,next) =>{
    try {
        const service = req.params.service;
        const paymentHash = req.params.payment_hash;
        const authAllowed = req.body.authAllowed;
        const authCategory = req.body.authCategory;
        const shouldSkipPaidVerify = authCategory === 1;
        const { invoice, isPaid } = await getIsInvoicePaid(paymentHash, shouldSkipPaidVerify);
        const successAction =  {
            tag: "url",
            url: `${process.env.ENDPOINT}/${service}/${paymentHash}/get_result`,
            description: "Open to get the confirmation code for your purchase."
        };

        logState(service, paymentHash, "POLL");
        if (!authAllowed && !isPaid) {
            res.status(402).send({ ...invoice, isPaid, authCategory, successAction});
        } 
        else {
            const doc = await findJobRequestByPaymentHash(paymentHash);

            console.log(`requestData: ${JSON.stringify(doc.requestData, null, 2)}`);

            switch (doc.state) {
            case "WORKING":
                // Check if job is in the queue
                const jobStatusInfo = jobManager.getJobInfo(paymentHash);
                if (jobStatusInfo) {
                    // If the job is in the queue, include queue information
                    const queueInfo = {
                        status: jobStatusInfo.status,
                        queuePosition: jobStatusInfo.queuePosition,
                        message: jobStatusInfo.status === 'QUEUED' 
                            ? `Your job is queued at position ${jobStatusInfo.queuePosition}` 
                            : 'Your job is currently being processed'
                    };
                    logState(service, paymentHash, "WORKING");
                    res.status(202).send({
                        state: doc.state, 
                        authCategory, 
                        paymentHash, 
                        queueInfo,
                        successAction
                    });
                } else {
                    // If not in queue but marked as WORKING, just return normal response
                    logState(service, paymentHash, "WORKING");
                    res.status(202).send({state: doc.state, authCategory, paymentHash, successAction});
                }
                break;
            case "ERROR":
            case "DONE":
                // Remove job from queue if it exists
                jobManager.removeJob(paymentHash);
                
                logState(service, paymentHash, doc.state);
                res.status(200).send({...doc.requestResponse, authCategory, paymentHash, successAction});
                break;
            default:
                logState(service, paymentHash, "PAID");
                const data = doc.requestData;
                
                // Add job to queue
                doc.state = "WORKING";
                await doc.save();
                
                // Adding to job manager queue
                const queuedJobInfo = jobManager.addJob(paymentHash, service);
                console.log(`Added job ${paymentHash} to queue, position: ${queuedJobInfo.queuePosition}`);
                
                // Return queue information
                const queueInfo = {
                    status: queuedJobInfo.status,
                    queuePosition: queuedJobInfo.queuePosition,
                    message: `Your job has been queued at position ${queuedJobInfo.queuePosition}`
                };
                
                res.status(202).send({ 
                    state: "WORKING", 
                    queueInfo, 
                    authCategory,
                    paymentHash,
                    successAction 
                });
            }
        }
    } catch (e) {
        console.log(e.toString().substring(0, 300));
        res.status(500).send(e);
    }
});

exports.testLogger = asyncHandler(async (req, res, next) => {

    console.log(`postTest req.body:`, JSON.stringify(req.body, null, 2));
    if (req?.file) {
        console.log('Uploaded File Path:', req?.file?.path);
    }
    res.status(200).send({'test': 'test'});
});

exports.getQueueStatus = asyncHandler(async (req, res, next) => {
    try {
        // Get queue information
        const queueSize = jobManager.getQueueSize();
        const processingCount = jobManager.getProcessingCount();
        
        res.status(200).json({
            queueSize,
            processingCount,
            status: 'healthy'
        });
    } catch (e) {
        console.error('Error getting queue status:', e);
        res.status(500).send(e);
    }
});