const { ethers } = require('ethers');

// Minimal ERC-20 adapter for USDC-like tokens
class ERC20Adapter {
  constructor(provider, tokenAddress) {
    this.provider = provider;
    this.address = tokenAddress;
    this.abi = [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)'
    ];
    this.contract = new ethers.Contract(this.address, this.abi, this.provider);
  }

  async getDecimals() {
    return await this.contract.decimals();
  }

  async getSymbol() {
    return await this.contract.symbol();
  }

  async balanceOf(address) {
    return await this.contract.balanceOf(address);
  }

  connect(signer) {
    const c = this.contract.connect(signer);
    const txSender = {
      transfer: async (to, amount) => {
        // USDC uses 6 decimals typically; adapter doesn't normalize
        const tx = await c.transfer(to, amount);
        return tx.wait();
      }
    };
    return txSender;
  }
}

module.exports = ERC20Adapter;
