const ethers = require('ethers');
const ERC20Adapter = require('../adapters/erc20-usdc');

async function main(){
  // Uses Polygon Mumbai public RPC for quick test (read-only)
  const provider = new ethers.JsonRpcProvider('https://rpc.ankr.com/polygon_mumbai');
  const usdcAddress = '0xe6b8a5cf854791412c1f6efc7caf629f5df1c747'; // Mumbai USDC token address (Polygonscan)
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
