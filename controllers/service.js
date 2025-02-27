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
    convertToMp3
} = require('../lib/fileManagement');
const path = require('path');
const { TEMP_DIR } = require('../lib/fileManagement');

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
    const heartbeatDisabled = req.body?.heartbeatDisabled || false;

    let heartbeatInterval = null;
    let heartbeatCount = 0;
    const maxHeartbeatCount = 5;
    if(!heartbeatDisabled) {
        // Start a periodic heartbeat to keep the connection alive
        heartbeatInterval = setInterval(() => {
            res.flushHeaders(); // Flush headers periodically
            console.log('Flushed headers to keep the connection alive.');

            heartbeatCount++;
            if (heartbeatCount >= maxHeartbeatCount) {
                console.log('Heartbeat limit reached. Clearing interval.');
                clearInterval(heartbeatInterval);
            }
        }, 20000); // Every 20 seconds
    }

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

                if (!validateAudioSize(audioFilePath)) {
                    return res.status(400).send("File is too large to transcribe. The limit is 25MB.");
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
        // Clear the heartbeat when the process is complete
        if(heartbeatInterval !== null) {
            clearInterval(heartbeatInterval);
        }
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
                // Clear the heartbeat on error
                if(heartbeatInterval !== null) {
                    clearInterval(heartbeatInterval);
                }
                return res.status(400).send('Invalid file format. Supported formats: ' + 
                    ALLOWED_AUDIO_FORMATS.concat(ALLOWED_VIDEO_FORMATS).join(', '));
            }

            originalFilePath = await downloadRemoteFile(remoteUrl);
        } else if (req.file) {
            if (!isAllowedFormat(req.file.originalname)) {
                // Clear the heartbeat on error
                if(heartbeatInterval !== null) {
                    clearInterval(heartbeatInterval);
                }
                return res.status(400).send('Invalid file format. Supported formats: ' + 
                    ALLOWED_AUDIO_FORMATS.concat(ALLOWED_VIDEO_FORMATS).join(', '));
            }
            originalFilePath = req.file.path;
        } else {
            // Clear the heartbeat on error
            if(heartbeatInterval !== null) {
                clearInterval(heartbeatInterval);
            }
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

        if (!validateAudioSize(audioFilePath)) {
            // Clear the heartbeat on error
            if(heartbeatInterval !== null) {
                clearInterval(heartbeatInterval);
            }
            return res.status(400).send("File is too large to transcribe. The limit is 25MB.");
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
        // Clear the heartbeat when finished
        if(heartbeatInterval !== null) {
            clearInterval(heartbeatInterval);
        }
        res.status(402).send({...invoice, authCategory: req.body.authCategory, successAction});

    } catch (e) {
        console.log(e.toString().substring(0, 150));
        // Clear the heartbeat on error
        if(heartbeatInterval !== null) {
            clearInterval(heartbeatInterval);
        }
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
        const heartbeatDisabled = req.body?.heartbeatDisabled || false;
        const { invoice, isPaid } = await getIsInvoicePaid(paymentHash, shouldSkipPaidVerify);
        const successAction =  {
            tag: "url",
            url: `${process.env.ENDPOINT}/${service}/${paymentHash}/get_result`,
            description: "Open to get the confirmation code for your purchase."
        };

        let heartbeatInterval = null;
        let heartbeatCount = 0;
        const maxHeartbeatCount = 5;
        if(!heartbeatDisabled) {
            // Start a periodic heartbeat to keep the connection alive
            heartbeatInterval = setInterval(() => {
                res.flushHeaders(); // Flush headers periodically
                console.log('Flushed headers to keep the connection alive.');

                heartbeatCount++;
                if (heartbeatCount >= maxHeartbeatCount) {
                    console.log('Heartbeat limit reached. Clearing interval.');
                    clearInterval(heartbeatInterval);
                }
            }, 20000); // Every 20 seconds
        }

        logState(service, paymentHash, "POLL");
        if (!authAllowed && !isPaid) {
            // Clear the heartbeat if unpaid
            if(heartbeatInterval !== null) {
                clearInterval(heartbeatInterval);
            }
            res.status(402).send({ ...invoice, isPaid, authCategory, successAction});
        } 
        else {
            const doc = await findJobRequestByPaymentHash(paymentHash);

            console.log(`requestData: ${JSON.stringify(doc.requestData, null, 2)}`);

            switch (doc.state) {
            case "WORKING":
                logState(service, paymentHash, "WORKING");
                // Clear the heartbeat if still working
                if(heartbeatInterval !== null) {
                    clearInterval(heartbeatInterval);
                }
                res.status(202).send({state: doc.state, authCategory, paymentHash, successAction});
                break;
            case "ERROR":
            case "DONE":
                logState(service, paymentHash, doc.state);
                // Clear the heartbeat when done
                if(heartbeatInterval !== null) {
                    clearInterval(heartbeatInterval);
                }
                res.status(200).send({...doc.requestResponse, authCategory, paymentHash, successAction});
                break;
            default:
                logState(service, paymentHash, "PAID");
                const data = doc.requestData;
                // Use async/await to ensure sequential execution
                try {
                    const fullPath = path.join(TEMP_DIR, data.filePath);
                    const response = await submitService(service, { ...data, filePath: fullPath });
                    console.log(`requestResponse:`,response);
                    doc.requestResponse = response;
                    doc.state = "DONE";
                    console.log(`DONE ${service} ${paymentHash} ${response}`);
                    await doc.save();
                    console.log("Doc saved!")
                    // Clear the heartbeat when complete
                    if(heartbeatInterval !== null) {
                        clearInterval(heartbeatInterval);
                    }
                    res.status(200).send({...doc.requestResponse, authCategory, paymentHash, successAction});
                    return;
                } catch (e) {
                    doc.requestResponse = e;
                    doc.state = "ERROR";
                    await doc.save();
                    console.log("submitService error:", e);
                }

                await doc.save();
                // Clear the heartbeat when complete
                if(heartbeatInterval !== null) {
                    clearInterval(heartbeatInterval);
                }
                res.status(202).send({ state: doc.state });
            }
        }
    } catch (e) {
    console.log(e.toString().substring(0, 300));
    // Clear the heartbeat on error
    if(heartbeatInterval !== null) {
        clearInterval(heartbeatInterval);
    }
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