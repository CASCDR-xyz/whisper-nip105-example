function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function usd_to_millisats(servicePriceUSD, bitcoinPrice) {
    const profitMarginFactor = 1.0 + process.env.PROFIT_MARGIN_PCT / 100.0;
    const rawValue = (servicePriceUSD * 100000000000 * profitMarginFactor) / bitcoinPrice;
    const roundedValue = Math.round(rawValue / 1000) * 1000; // Round to the nearest multiple of 1000
    return roundedValue;
}

function logState(service, paymentHash, state) {
    console.log(`${paymentHash.substring(0, 5)} - ${service}: ${state}`);
}

module.exports = { sleep, usd_to_millisats, logState };