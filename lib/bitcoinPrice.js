const axios = require('axios');

async function getBitcoinPriceFromCoinbase() {
  try {
    const response = await axios.get('https://api.coinbase.com/v2/prices/BTC-USD/spot');
    const data = response.data;
    return data.data.amount;
  } catch (error) {
    // Silently fail and let other sources be used
    return 0;
  }
}

async function getBitcoinPriceFromKraken() {
  try {
    const response = await axios.get('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
    const price = response.data.result.XXBTZUSD.a[0];
    return price;
  } catch (error) {
    // Silently fail and let other sources be used
    return 0;
  }
}

async function getBitcoinPriceFromCoindesk() {
  try {
    const response = await axios.get('https://api.coindesk.com/v1/bpi/currentprice.json');
    const price = response.data.bpi.USD.rate_float;
    return price;
  } catch (error) {
    // Silently fail and let other sources be used
    return 0;
  }
}

async function getBitcoinPriceFromGemini() {
  try {
    const response = await axios.get('https://api.gemini.com/v2/ticker/BTCUSD');
    const price = response.data.bid;
    return price;
  } catch (error) {
    // Silently fail and let other sources be used
    return 0;
  }
}

async function getBitcoinPriceFromCoinGecko() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&precision=2');
    const price = response.data.bitcoin.usd;
    return price;
  } catch (error) {
    // Silently fail and let other sources be used
    return 0;
  }
}

async function getBitcoinPrice() {
  try {
    const cbprice = await getBitcoinPriceFromCoinbase();
    const kprice = await getBitcoinPriceFromKraken();
    const cdprice = await getBitcoinPriceFromCoindesk();
    const gprice = await getBitcoinPriceFromGemini();
    const cgprice = await getBitcoinPriceFromCoinGecko();
    
    const prices = [cbprice, kprice, cdprice, gprice, cgprice].map(Number);
    prices.sort();
    // Return median price (if all fail, returns 0)
    return prices[2];
  } catch (error) {
    // Only log if all sources completely fail
    console.error(`Critical: All Bitcoin price sources failed: ${error.message}`);
    return 0;
  }
}

module.exports = {
  getBitcoinPriceFromCoinbase,
  getBitcoinPriceFromKraken,
  getBitcoinPriceFromCoindesk,
  getBitcoinPriceFromGemini,
  getBitcoinPriceFromCoinGecko,
  getBitcoinPrice,
};
