const asyncHandler = require('../middleware/async');
const crypto = require('crypto');
const { getServicePrice, submitService } = require('../lib/service');
const { createNewJobDocument, findJobRequestByPaymentHash, getIsInvoicePaid, generateInvoice } = require('../lib/nip105');
const { logState } = require('../lib/common');

exports.postService = asyncHandler(async (req,res,next) =>{
    const authAllowed = req.body?.authAllowed;
    const service = req.params.service;
    if (authAllowed) {
      // Simulate successful payment and service execution
      try {
          // Create a fake payment hash
          const fakePaymentHash = crypto.randomBytes(20).toString('hex');
          const price = await getServicePrice(service); // Assuming price determination logic is in place
          const fakeInvoice = { verify: "fakeURL", pr: "fakePaymentRequest", paymentHash: fakePaymentHash };

          // Directly simulate creating a new job document as if it was paid
          await createNewJobDocument(service, fakeInvoice, fakePaymentHash, price);

          // Simulate executing the service directly and preparing the result
          const doc = await findJobRequestByPaymentHash(fakePaymentHash);
          doc.status = "PAID";
          doc.state = "NOT_PAID";//set invoice to paid but work status as NOT_PAID to force run
          doc.requestData = req.body;
          await doc.save();

          const successAction =  {
            tag: "url",
            url: `${process.env.ENDPOINT}/${service}/${fakePaymentHash}/get_result`,
            description: "Open to get the confirmation code for your purchase."
          };

          // Return the simulated result
          res.status(200).send({paymentHash: fakePaymentHash, authCategory: req.body.authCategory, successAction});
      } catch (e) {
          console.log(e.toString().substring(0, 150));
          res.status(500).send(e);
      }
      return;
    }
    try {
      const service = req.params.service;
      const invoice = await generateInvoice(service);
      const doc = await findJobRequestByPaymentHash(invoice.paymentHash);
      const successAction =  {
        tag: "url",
        url: `${process.env.ENDPOINT}/${service}/${invoice.paymentHash}/get_result`,
        description: "Open to get the confirmation code for your purchase."
    };
  
      doc.requestData = req.body;
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

            switch (doc.state) {
            case "WORKING":
                logState(service, paymentHash, "WORKING");
                res.status(202).send({state: doc.state, authCategory, paymentHash, successAction});
                break;
            case "ERROR":
            case "DONE":
                logState(service, paymentHash, doc.state);
                res.status(200).send({...doc.requestResponse, authCategory, paymentHash, successAction});
                break;
            default:
                logState(service, paymentHash, "PAID");
                const data = doc.requestData;
                // Use async/await to ensure sequential execution
                try {
                    const response = await submitService(service, data);
                    console.log(`requestResponse:`,response);
                    doc.requestResponse = response;
                    doc.state = "DONE";
                    console.log(`DONE ${service} ${paymentHash} ${response}`);
                    await doc.save();
                    console.log("Doc saved!")
                } catch (e) {
                    doc.requestResponse = e;
                    doc.state = "ERROR";
                    await doc.save();
                    console.log("submitService error:", e)
                }

                doc.state = "WORKING";
                await sleep(1000)
                await doc.save();
                res.status(202).send({ state: doc.state });
            }
        }
    } catch (e) {
    console.log(e.toString().substring(0, 300));
    res.status(500).send(e);
    }
});