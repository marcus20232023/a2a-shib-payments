const ethers = require('ethers');
const ERC20Adapter = require('../adapters/erc20-usdc');

async function main(){
  // Uses Polygon Amoy testnet (Mumbai successor)
  const provider = new ethers.JsonRpcProvider('https://polygon-amoy.g.alchemy.com/v2/hVPR2ngPHhDRUCWKsS_hX');
  const usdcAddress = '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582'; // Amoy USDC token address
  const adapter = new ERC20Adapter(provider, usdcAddress);
  try{
    const symbol = await adapter.getSymbol();
    const decimals = await adapter.getDecimals();
    console.log('symbol', symbol, 'decimals', decimals);
  }catch(err){
    console.error('Read test failed - replace token address with a Mumbai USDC address', err.message);
    process.exit(1);
  }
}

main();
