const JobRequest = require("../models/jobRequest");
const axios = require("axios");
const bolt11 = require("bolt11");
const { getServicePrice } = require("./service");

function getLNURL() {
    const parts = process.env.LN_ADDRESS.split("@");
    if (parts.length !== 2) {
      throw new Error(`Invalid lnAddress: ${process.env.LN_ADDRESS}`);
    }
    const username = parts[0];
    const domain = parts[1];
    return `https://${domain}/.well-known/lnurlp/${username}`;
}

async function createNewJobDocument(service, invoice, paymentHash, price) {
    const newDocument = new JobRequest({
      invoice,
      paymentHash,
      verifyURL: invoice.verify,
      price,
      service,
      status: "UNPAID",
      result: null,
      requestData: null,
    });
  
    // Save the document to the collection
    await newDocument.save();
}

async function findJobRequestByPaymentHash(paymentHash) {
    const jobRequest = await JobRequest.findOne({ paymentHash }).exec();
    if (!jobRequest) {
      throw new Error("No Doc found");
    }
  
    return jobRequest;
}

async function getIsInvoicePaid(paymentHash) {
    const doc = await findJobRequestByPaymentHash(paymentHash);
  
    const invoice = doc.invoice;
  
    if (doc.status == "PAID") {
      return { isPaid: true, invoice };
    }
  
    const response = await axios.get(doc.verifyURL, {
      headers: {
        Accept: "application/json",
      },
    });
  
    const isPaid = response.data.settled == true;
  
    doc.status = isPaid ? "PAID" : doc.status;
    await doc.save();
  
    return { isPaid, invoice };
}

async function getPaymentHash(invoice) {
    const decodedInvoice = await bolt11.decode(invoice);
    const paymentHashTag = decodedInvoice.tags.find(
      (tag) => tag.tagName === "payment_hash"
    ).data;
    return paymentHashTag;
}

function getSuccessAction(service, paymentHash) {
  return {
    tag: "url",
    url: `${process.env.ENDPOINT}/${service}/${paymentHash}/get_result`,
    description: "Open to get the confirmation code for your purchase.",
  };
}
  
async function generateInvoice(service) {
    console.log("generateInvoice started..")
    const msats = await getServicePrice(service);
    console.log("getServicePrice msats:",msats)
    const lnurlResponse = await axios.get(getLNURL(), {
      headers: {
        Accept: "application/json",
      },
    });
  
    const lnAddress = lnurlResponse.data;
  
    if (msats > lnAddress.maxSendable || msats < lnAddress.minSendable) {
      throw new Error(
        `${msats} msats not in sendable range of ${lnAddress.minSendable} - ${lnAddress.maxSendable}`
      );
    }
  
    const expiration = new Date(Date.now() + 3600 * 1000); // One hour from now
    const url = `${lnAddress.callback}?amount=${msats}&expiry=${Math.floor(
      expiration.getTime() / 1000
    )}`;
  
    const invoiceResponse = await axios.get(url);
    const invoiceData = invoiceResponse.data;
  
    const paymentHash = await getPaymentHash(invoiceData.pr);
    const successAction = getSuccessAction(service, paymentHash);
  
    const invoice = { ...invoiceData, successAction, paymentHash };
  
    await createNewJobDocument(service, invoice, paymentHash, msats);
  
    return invoice;
}

module.exports = {
    getLNURL,
    createNewJobDocument,
    getIsInvoicePaid,
    generateInvoice,
    findJobRequestByPaymentHash
}