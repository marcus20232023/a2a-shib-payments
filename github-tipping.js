/**
 * GitHub Tipping System
 * 
 * Enables agents to tip on GitHub repositories via A2A escrow
 * 
 * Features:
 * - Tip GitHub repositories directly from agent
 * - Support for SHIB and USDC tokens
 * - Escrow-backed tipping with release on settlement
 * - Tip history and analytics
 * - Webhook integration for automated tips
 * 
 * Flow:
 * 1. Agent initiates tip on GitHub repo (owner/repo)
 * 2. Tip creates A2A escrow (payer → recipient)
 * 3. Escrow transitions: pending → funded → locked → released
 * 4. Tip recorded with GitHub metadata
 * 5. Settlement releases funds to recipient wallet
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class GitHubTippingSystem {
  constructor(escrowSystem, storePath = './github-tips.json') {
    this.escrowSystem = escrowSystem;
    this.storePath = storePath;
    this.tips = this.loadState();
    this.webhookHandlers = [];
  }

  loadState() {
    if (fs.existsSync(this.storePath)) {
      const data = fs.readFileSync(this.storePath, 'utf8');
      return JSON.parse(data);
    }
    return {};
  }

  saveState() {
    // Ensure directory exists
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.storePath, JSON.stringify(this.tips, null, 2));
  }

  /**
   * Validate GitHub repository reference
   * @param {string} repoRef - Format: "owner/repo"
   */
  validateGitHubRepo(repoRef) {
    if (!repoRef || typeof repoRef !== 'string') {
      throw new Error('Invalid GitHub repository reference');
    }

    const parts = repoRef.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error('GitHub repository must be in format: owner/repo');
    }

    // Validate owner and repo names (GitHub naming rules)
    const validNamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
    if (!validNamePattern.test(parts[0]) || !validNamePattern.test(parts[1])) {
      throw new Error('Invalid GitHub owner or repository name');
    }

    return { owner: parts[0], repo: parts[1] };
  }

  /**
   * Validate GitHub username or ETH address (tip destination)
   */
  validateRecipient(recipientId) {
    if (!recipientId || typeof recipientId !== 'string') {
      throw new Error('Invalid recipient identifier');
    }

    // GitHub username pattern (3-39 chars, alphanumeric + hyphens)
    const githubPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
    
    // ETH address pattern (0x + 40 hex chars)
    const ethPattern = /^0x[a-fA-F0-9]{40}$/;

    const isGitHub = githubPattern.test(recipientId) && recipientId.length <= 39;
    const isEthAddress = ethPattern.test(recipientId);

    if (!isGitHub && !isEthAddress) {
      throw new Error('Recipient must be GitHub username or ETH address (0x...)');
    }

    return {
      value: recipientId,
      type: isEthAddress ? 'ethereum' : 'github',
    };
  }

  /**
   * Create a GitHub tip
   * 
   * @param {object} params
   * @param {string} params.githubRepo - GitHub repository (owner/repo)
   * @param {string} params.tipper - Agent ID or ETH address of tipper
   * @param {string} params.recipient - GitHub username or ETH address
   * @param {number} params.amount - Tip amount
   * @param {string} params.token - Token symbol (SHIB or USDC)
   * @param {string} params.message - Optional tip message
   * @param {string} params.issueUrl - Optional: GitHub issue/PR URL
   * @param {string} params.commitRef - Optional: Git commit SHA
   */
  createTip({
    githubRepo,
    tipper,
    recipient,
    amount,
    token = 'SHIB',
    message = null,
    issueUrl = null,
    commitRef = null
  }) {
    // Validate inputs
    const repo = this.validateGitHubRepo(githubRepo);
    const recipientInfo = this.validateRecipient(recipient);

    if (!tipper || typeof tipper !== 'string') {
      throw new Error('Invalid tipper identifier');
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Tip amount must be a positive number');
    }

    if (!['SHIB', 'USDC'].includes(token)) {
      throw new Error('Token must be SHIB or USDC');
    }

    // Create tip record
    const tipId = 'tip_' + crypto.randomBytes(16).toString('hex');
    const now = Date.now();

    const tip = {
      id: tipId,
      github: {
        repo: githubRepo,
        owner: repo.owner,
        repoName: repo.repo,
        issueUrl: issueUrl || null,
        commitRef: commitRef || null,
        timestamp: now
      },
      tipper,
      recipient: recipientInfo.value,
      recipientType: recipientInfo.type,
      amount,
      token,
      message: message || null,
      state: 'pending', // pending → escrow_created → funded → locked → released
      escrowId: null,
      timeline: {
        created: now,
        escrowCreated: null,
        funded: null,
        locked: null,
        released: null
      },
      settlement: {
        txHash: null,
        blockNumber: null,
        gasUsed: null,
        timestamp: null
      },
      metadata: {
        tokenAdapter: token === 'USDC' ? 'erc20-usdc' : 'native',
        requiresApproval: token === 'USDC',
        source: 'github-tipping'
      }
    };

    this.tips[tipId] = tip;
    this.saveState();

    return tip;
  }

  /**
   * Create escrow for a tip
   * Moves tip from pending to escrow_created state
   * 
   * @param {string} tipId - Tip ID
   * @param {function} escrowCreator - Function that creates escrow and returns escrow ID
   */
  createEscrow(tipId, escrowCreator) {
    const tip = this.tips[tipId];
    if (!tip) throw new Error('Tip not found');
    if (tip.state !== 'pending') {
      throw new Error(`Cannot create escrow for tip in state: ${tip.state}`);
    }

    // Call escrow creator function with tip data
    const escrowId = escrowCreator(tip);

    tip.state = 'escrow_created';
    tip.escrowId = escrowId;
    tip.timeline.escrowCreated = Date.now();

    this.saveState();

    return {
      tipId,
      escrowId,
      tip
    };
  }

  /**
   * Mark escrow as funded
   */
  fundEscrow(tipId, txHash) {
    const tip = this.tips[tipId];
    if (!tip) throw new Error('Tip not found');
    if (tip.state !== 'escrow_created') {
      throw new Error(`Cannot fund escrow for tip in state: ${tip.state}`);
    }

    tip.state = 'funded';
    tip.timeline.funded = Date.now();
    tip.settlement.txHash = txHash;

    this.saveState();

    return tip;
  }

  /**
   * Mark escrow as locked (ready for release)
   */
  lockEscrow(tipId) {
    const tip = this.tips[tipId];
    if (!tip) throw new Error('Tip not found');
    if (tip.state !== 'funded') {
      throw new Error(`Cannot lock escrow for tip in state: ${tip.state}`);
    }

    tip.state = 'locked';
    tip.timeline.locked = Date.now();

    this.saveState();

    return tip;
  }

  /**
   * Release tip to recipient
   */
  releaseTip(tipId, txHash, blockNumber, gasUsed = null) {
    const tip = this.tips[tipId];
    if (!tip) throw new Error('Tip not found');
    if (tip.state !== 'locked') {
      throw new Error(`Cannot release tip in state: ${tip.state}`);
    }

    tip.state = 'released';
    tip.timeline.released = Date.now();
    tip.settlement.txHash = txHash;
    tip.settlement.blockNumber = blockNumber;
    if (gasUsed) tip.settlement.gasUsed = gasUsed;
    tip.settlement.timestamp = Date.now();

    this.saveState();

    return tip;
  }

  /**
   * Cancel a tip (refund to tipper)
   */
  cancelTip(tipId, reason = 'manual cancellation') {
    const tip = this.tips[tipId];
    if (!tip) throw new Error('Tip not found');
    if (!['pending', 'escrow_created', 'funded', 'locked'].includes(tip.state)) {
      throw new Error(`Cannot cancel tip in state: ${tip.state}`);
    }

    tip.state = 'cancelled';
    tip.metadata.cancellationReason = reason;
    tip.timeline.cancelled = Date.now();

    this.saveState();

    return tip;
  }

  /**
   * Get tip by ID
   */
  getTip(tipId) {
    return this.tips[tipId] || null;
  }

  /**
   * List tips with filters
   */
  listTips(filters = {}) {
    let results = Object.values(this.tips);

    if (filters.githubRepo) {
      results = results.filter(t => t.github.repo === filters.githubRepo);
    }

    if (filters.owner) {
      results = results.filter(t => t.github.owner === filters.owner);
    }

    if (filters.tipper) {
      results = results.filter(t => t.tipper === filters.tipper);
    }

    if (filters.recipient) {
      results = results.filter(t => t.recipient === filters.recipient);
    }

    if (filters.state) {
      const states = Array.isArray(filters.state) ? filters.state : [filters.state];
      results = results.filter(t => states.includes(t.state));
    }

    if (filters.token) {
      results = results.filter(t => t.token === filters.token);
    }

    if (filters.minAmount) {
      results = results.filter(t => t.amount >= filters.minAmount);
    }

    // Sort by creation time, newest first
    return results.sort((a, b) => b.timeline.created - a.timeline.created);
  }

  /**
   * Get repository tipping statistics
   */
  getRepoStats(githubRepo) {
    const repoTips = this.listTips({ githubRepo });

    const totalTips = repoTips.length;
    const releasedTips = repoTips.filter(t => t.state === 'released').length;
    
    const totalAmount = repoTips.reduce((sum, t) => sum + t.amount, 0);
    const releasedAmount = repoTips
      .filter(t => t.state === 'released')
      .reduce((sum, t) => sum + t.amount, 0);

    const byToken = {};
    repoTips.forEach(t => {
      if (!byToken[t.token]) {
        byToken[t.token] = { count: 0, total: 0 };
      }
      byToken[t.token].count += 1;
      byToken[t.token].total += t.amount;
    });

    const byState = {};
    repoTips.forEach(t => {
      byState[t.state] = (byState[t.state] || 0) + 1;
    });

    return {
      githubRepo,
      totalTips,
      releasedTips,
      totalAmount,
      releasedAmount,
      byToken,
      byState,
      averageTip: totalTips > 0 ? (totalAmount / totalTips).toFixed(2) : 0
    };
  }

  /**
   * Get tipper statistics
   */
  getTipperStats(tipper) {
    const tipperTips = this.listTips({ tipper });

    const totalTips = tipperTips.length;
    const releasedTips = tipperTips.filter(t => t.state === 'released').length;
    
    const totalAmount = tipperTips.reduce((sum, t) => sum + t.amount, 0);
    const releasedAmount = tipperTips
      .filter(t => t.state === 'released')
      .reduce((sum, t) => sum + t.amount, 0);

    // Top repositories by tip count
    const repoStats = {};
    tipperTips.forEach(t => {
      if (!repoStats[t.github.repo]) {
        repoStats[t.github.repo] = { count: 0, total: 0 };
      }
      repoStats[t.github.repo].count += 1;
      repoStats[t.github.repo].total += t.amount;
    });

    const topRepos = Object.entries(repoStats)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .reduce((acc, [repo, stats]) => {
        acc[repo] = stats;
        return acc;
      }, {});

    return {
      tipper,
      totalTips,
      releasedTips,
      totalAmount,
      releasedAmount,
      topRepos,
      averageTip: totalTips > 0 ? (totalAmount / totalTips).toFixed(2) : 0
    };
  }

  /**
   * Register webhook handler (for webhooks from external services)
   */
  onWebhookTip(handler) {
    this.webhookHandlers.push(handler);
  }

  /**
   * Trigger webhook handlers for a tip event
   */
  async triggerWebhook(event, tipData) {
    const promises = this.webhookHandlers.map(handler =>
      Promise.resolve(handler(event, tipData)).catch(err =>
        console.error(`Webhook handler error: ${err.message}`)
      )
    );
    await Promise.all(promises);
  }

  /**
   * Process tips in a batch (e.g., nightly settlement)
   */
  processBatch(filters = {}) {
    const tipsToProcess = this.listTips({
      ...filters,
      state: ['locked', 'funded']
    });

    return {
      count: tipsToProcess.length,
      tips: tipsToProcess,
      totalAmount: tipsToProcess.reduce((sum, t) => sum + t.amount, 0)
    };
  }

  /**
   * Get overall tipping statistics
   */
  getGlobalStats() {
    const allTips = Object.values(this.tips);

    const totalTips = allTips.length;
    const releasedTips = allTips.filter(t => t.state === 'released').length;
    
    const totalAmount = allTips.reduce((sum, t) => sum + t.amount, 0);
    const releasedAmount = allTips
      .filter(t => t.state === 'released')
      .reduce((sum, t) => sum + t.amount, 0);

    const byToken = {};
    allTips.forEach(t => {
      if (!byToken[t.token]) {
        byToken[t.token] = { count: 0, total: 0 };
      }
      byToken[t.token].count += 1;
      byToken[t.token].total += t.amount;
    });

    const byState = {};
    allTips.forEach(t => {
      byState[t.state] = (byState[t.state] || 0) + 1;
    });

    const topRepositories = this.listTips()
      .reduce((acc, t) => {
        if (!acc[t.github.repo]) {
          acc[t.github.repo] = { count: 0, total: 0 };
        }
        acc[t.github.repo].count += 1;
        acc[t.github.repo].total += t.amount;
        return acc;
      }, {});

    const sortedTopRepos = Object.entries(topRepositories)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .reduce((acc, [repo, stats]) => {
        acc[repo] = stats;
        return acc;
      }, {});

    return {
      totalTips,
      releasedTips,
      totalAmount,
      releasedAmount,
      byToken,
      byState,
      topRepositories: sortedTopRepos,
      averageTip: totalTips > 0 ? (totalAmount / totalTips).toFixed(2) : 0
    };
  }
}

module.exports = { GitHubTippingSystem };
