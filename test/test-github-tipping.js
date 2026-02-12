#!/usr/bin/env node

/**
 * GitHub Tipping System Test Suite
 * 
 * Tests:
 * - Repository validation
 * - Recipient validation (GitHub username, ETH address)
 * - Tip creation and state transitions
 * - Escrow integration
 * - Statistics and filtering
 * - Batch processing
 * - Error handling
 */

const { GitHubTippingSystem } = require('../github-tipping');
const { EscrowSystem } = require('../escrow');
const fs = require('fs');
const path = require('path');

// Test utilities
const testDir = path.join(__dirname, '..', 'test-data');
const testTipsFile = path.join(testDir, 'test-github-tips.json');
const testEscrowFile = path.join(testDir, 'test-escrow-state.json');

// Cleanup helper
function cleanup() {
  if (fs.existsSync(testTipsFile)) fs.unlinkSync(testTipsFile);
  if (fs.existsSync(testEscrowFile)) fs.unlinkSync(testEscrowFile);
  if (fs.existsSync(testDir) && fs.readdirSync(testDir).length === 0) {
    fs.rmdirSync(testDir);
  }
}

// Create test directory
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

console.log('\n📊 GitHub Tipping System Test Suite\n');

// Test 1: Initialization
test('Should initialize GitHubTippingSystem', () => {
  cleanup();
  const escrow = new EscrowSystem(testEscrowFile);
  const tipping = new GitHubTippingSystem(escrow, testTipsFile);
  assert(tipping !== null, 'Tipping system should be initialized');
  assert(Object.keys(tipping.tips).length === 0, 'Should start with no tips');
});

// Test 2: GitHub Repository Validation
test('Should validate correct GitHub repo format (owner/repo)', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  const result = tipping.validateGitHubRepo('ethereum/go-ethereum');
  assert(result.owner === 'ethereum', 'Should extract owner');
  assert(result.repo === 'go-ethereum', 'Should extract repo');
});

test('Should reject invalid GitHub repo format', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  try {
    tipping.validateGitHubRepo('invalid-format');
    throw new Error('Should have thrown error');
  } catch (err) {
    assert(err.message.includes('owner/repo'), 'Should mention correct format');
  }
});

test('Should reject empty repository reference', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  try {
    tipping.validateGitHubRepo('');
    throw new Error('Should have thrown error');
  } catch (err) {
    assert(err.message.includes('Invalid'), 'Should indicate invalid input');
  }
});

// Test 3: Recipient Validation
test('Should accept valid GitHub username as recipient', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  const result = tipping.validateRecipient('vitalik-buterin');
  assert(result.type === 'github', 'Should identify as GitHub username');
  assert(result.value === 'vitalik-buterin', 'Should preserve username');
});

test('Should accept valid ETH address as recipient', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  const result = tipping.validateRecipient('0x1234567890123456789012345678901234567890');
  assert(result.type === 'ethereum', 'Should identify as Ethereum address');
  assert(result.value.toLowerCase() === '0x1234567890123456789012345678901234567890');
});

test('Should reject invalid recipient format', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  try {
    tipping.validateRecipient('invalid@recipient!');
    throw new Error('Should have thrown error');
  } catch (err) {
    assert(err.message.includes('GitHub username or ETH address'), 'Should mention valid formats');
  }
});

// Test 4: Tip Creation
test('Should create tip successfully', () => {
  cleanup();
  const escrow = new EscrowSystem(testEscrowFile);
  const tipping = new GitHubTippingSystem(escrow, testTipsFile);
  
  const tip = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: '0x1234567890123456789012345678901234567890',
    amount: 100,
    token: 'SHIB',
    message: 'Great work on consensus!'
  });

  assert(tip.id.startsWith('tip_'), 'Should have tip ID');
  assert(tip.state === 'pending', 'Should start in pending state');
  assert(tip.amount === 100, 'Should have correct amount');
  assert(tip.token === 'SHIB', 'Should have correct token');
  assert(tip.message === 'Great work on consensus!', 'Should store message');
});

test('Should create tip with USDC token', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  const tip = tipping.createTip({
    githubRepo: 'uniswap/v3-core',
    tipper: 'agent-2',
    recipient: 'uniswap-dao',
    amount: 500,
    token: 'USDC'
  });

  assert(tip.token === 'USDC', 'Should support USDC token');
  assert(tip.metadata.requiresApproval === true, 'USDC should require approval');
});

test('Should reject tip with invalid amount', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  try {
    tipping.createTip({
      githubRepo: 'ethereum/go-ethereum',
      tipper: 'agent-1',
      recipient: 'vitalik',
      amount: -100,
      token: 'SHIB'
    });
    throw new Error('Should have thrown error');
  } catch (err) {
    assert(err.message.includes('positive number'), 'Should require positive amount');
  }
});

test('Should reject unsupported token', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  try {
    tipping.createTip({
      githubRepo: 'ethereum/go-ethereum',
      tipper: 'agent-1',
      recipient: 'vitalik',
      amount: 100,
      token: 'DOGE'
    });
    throw new Error('Should have thrown error');
  } catch (err) {
    assert(err.message.includes('SHIB or USDC'), 'Should list supported tokens');
  }
});

// Test 5: State Transitions
test('Should transition through escrow creation', () => {
  cleanup();
  const escrow = new EscrowSystem(testEscrowFile);
  const tipping = new GitHubTippingSystem(escrow, testTipsFile);
  
  const tip = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  // Create escrow
  const escrowCreator = (tip) => {
    const esc = escrow.create({
      payer: tip.tipper,
      payee: tip.recipient,
      amount: tip.amount,
      purpose: `GitHub tip: ${tip.github.repo}`,
      token: tip.token,
      timeoutMinutes: 1440 // 24 hours
    });
    return esc.id;
  };

  const result = tipping.createEscrow(tip.id, escrowCreator);
  assert(result.tipId === tip.id, 'Should link to tip');
  assert(result.escrowId.startsWith('esc_'), 'Should have escrow ID');

  const updatedTip = tipping.getTip(tip.id);
  assert(updatedTip.state === 'escrow_created', 'Should transition to escrow_created');
});

test('Should transition through funding', () => {
  cleanup();
  const escrow = new EscrowSystem(testEscrowFile);
  const tipping = new GitHubTippingSystem(escrow, testTipsFile);
  
  const tip = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  const escrowCreator = (tip) => {
    return escrow.create({
      payer: tip.tipper,
      payee: tip.recipient,
      amount: tip.amount,
      purpose: `GitHub tip: ${tip.github.repo}`,
      token: tip.token
    }).id;
  };

  tipping.createEscrow(tip.id, escrowCreator);
  tipping.fundEscrow(tip.id, '0xabc123');

  const updatedTip = tipping.getTip(tip.id);
  assert(updatedTip.state === 'funded', 'Should be funded');
  assert(updatedTip.settlement.txHash === '0xabc123', 'Should store tx hash');
});

test('Should transition through locking and release', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  const tip = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  tipping.createEscrow(tip.id, () => 'esc_12345');
  tipping.fundEscrow(tip.id, '0xabc123');
  tipping.lockEscrow(tip.id);

  let updatedTip = tipping.getTip(tip.id);
  assert(updatedTip.state === 'locked', 'Should be locked');

  tipping.releaseTip(tip.id, '0xdef456', 12345678, 50000);

  updatedTip = tipping.getTip(tip.id);
  assert(updatedTip.state === 'released', 'Should be released');
  assert(updatedTip.settlement.txHash === '0xdef456', 'Should store release tx');
  assert(updatedTip.settlement.blockNumber === 12345678, 'Should store block number');
});

// Test 6: Filtering and Listing
test('Should list tips with filters', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-2',
    recipient: 'vitalik',
    amount: 200,
    token: 'USDC'
  });

  tipping.createTip({
    githubRepo: 'uniswap/v3-core',
    tipper: 'agent-1',
    recipient: 'uniswap-dao',
    amount: 300,
    token: 'SHIB'
  });

  const ethereumTips = tipping.listTips({ githubRepo: 'ethereum/go-ethereum' });
  assert(ethereumTips.length === 2, 'Should filter by repo');

  const shibTips = tipping.listTips({ token: 'SHIB' });
  assert(shibTips.length === 2, 'Should filter by token');

  const agent1Tips = tipping.listTips({ tipper: 'agent-1' });
  assert(agent1Tips.length === 2, 'Should filter by tipper');
});

// Test 7: Statistics
test('Should calculate repository statistics', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-2',
    recipient: 'vitalik',
    amount: 200,
    token: 'SHIB'
  });

  const stats = tipping.getRepoStats('ethereum/go-ethereum');
  assert(stats.totalTips === 2, 'Should count total tips');
  assert(stats.totalAmount === 300, 'Should sum amounts');
  assert(stats.byToken.SHIB.count === 2, 'Should count by token');
});

test('Should calculate tipper statistics', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  tipping.createTip({
    githubRepo: 'uniswap/v3-core',
    tipper: 'agent-1',
    recipient: 'uniswap-dao',
    amount: 50,
    token: 'USDC'
  });

  const stats = tipping.getTipperStats('agent-1');
  assert(stats.totalTips === 2, 'Should count total tips by tipper');
  assert(stats.totalAmount === 150, 'Should sum amounts by tipper');
  assert(Object.keys(stats.topRepos).length === 2, 'Should list top repos');
});

test('Should calculate global statistics', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-2',
    recipient: 'vitalik',
    amount: 200,
    token: 'USDC'
  });

  const stats = tipping.getGlobalStats();
  assert(stats.totalTips === 2, 'Should count all tips');
  assert(stats.totalAmount === 300, 'Should sum all amounts');
  assert(stats.byToken.SHIB.count === 1, 'Should count SHIB tips');
  assert(stats.byToken.USDC.count === 1, 'Should count USDC tips');
});

// Test 8: Cancellation
test('Should cancel pending tip', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  const tip = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  tipping.cancelTip(tip.id, 'Changed my mind');

  const cancelled = tipping.getTip(tip.id);
  assert(cancelled.state === 'cancelled', 'Should be cancelled');
  assert(cancelled.metadata.cancellationReason === 'Changed my mind', 'Should store reason');
});

test('Should reject cancellation of released tip', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  const tip = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  tipping.createEscrow(tip.id, () => 'esc_123');
  tipping.fundEscrow(tip.id, '0xabc');
  tipping.lockEscrow(tip.id);
  tipping.releaseTip(tip.id, '0xdef', 123);

  try {
    tipping.cancelTip(tip.id);
    throw new Error('Should have thrown error');
  } catch (err) {
    assert(err.message.includes('Cannot cancel'), 'Should prevent cancellation');
  }
});

// Test 9: Batch Processing
test('Should process batch of tips', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  const tip1 = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB'
  });

  const tip2 = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-2',
    recipient: 'vitalik',
    amount: 200,
    token: 'SHIB'
  });

  tipping.createEscrow(tip1.id, () => 'esc_1');
  tipping.fundEscrow(tip1.id, '0xabc');
  tipping.lockEscrow(tip1.id);

  tipping.createEscrow(tip2.id, () => 'esc_2');
  tipping.fundEscrow(tip2.id, '0xdef');
  tipping.lockEscrow(tip2.id);

  const batch = tipping.processBatch();
  assert(batch.count === 2, 'Should find locked tips');
  assert(batch.totalAmount === 300, 'Should sum batch total');
});

// Test 10: GitHub Metadata
test('Should store GitHub issue and commit references', () => {
  cleanup();
  const tipping = new GitHubTippingSystem(new EscrowSystem(testEscrowFile), testTipsFile);
  
  const tip = tipping.createTip({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-1',
    recipient: 'vitalik',
    amount: 100,
    token: 'SHIB',
    issueUrl: 'https://github.com/ethereum/go-ethereum/issues/12345',
    commitRef: 'abc1234567890def1234567890def1234567890'
  });

  assert(tip.github.issueUrl === 'https://github.com/ethereum/go-ethereum/issues/12345', 'Should store issue URL');
  assert(tip.github.commitRef === 'abc1234567890def1234567890def1234567890', 'Should store commit ref');
});

// ============================================================================
// RESULTS
// ============================================================================

cleanup();

console.log('\n' + '='.repeat(50));
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
console.log(`Total Tests: ${testsPassed + testsFailed}`);
console.log('='.repeat(50) + '\n');

if (testsFailed > 0) {
  process.exit(1);
}
