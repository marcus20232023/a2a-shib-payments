# GitHub Tipping Feature

## Overview

The GitHub Tipping system enables agents and users to reward GitHub repository maintainers and contributors with direct payments using SHIB or USDC tokens. Payments are secured through A2A escrow, ensuring trustless settlement.

## Features

### ✅ Core Capabilities

- **Multi-Token Support:** Tip with SHIB or USDC
- **Flexible Recipients:** GitHub username or Ethereum address
- **Escrow Integration:** All tips backed by A2A escrow system
- **Auto-Settlement:** Optional automatic escrow creation and funding
- **Webhook Endpoints:** REST API for tip management
- **Statistics & Analytics:** Per-repo and per-tipper metrics
- **Batch Processing:** Support for nightly settlement runs
- **Git Integration:** Store commit references and issue links

### 🔒 Security Features

- Cryptographically signed escrow agreements
- Time-locked payments with auto-refund
- Recipient validation (GitHub/Ethereum)
- Transaction tracking with block confirmation
- Full audit trail of tip states

## Architecture

### Components

```
github-tipping.js           → Core tipping system (tip creation, state management)
github-tipping-webhook.js   → Express middleware (REST API endpoints)
test/test-github-tipping.js → Comprehensive test suite (22 test cases)
escrow.js                   → Trustless payment settlement
payment-negotiation.js      → Protocol support layer
```

### Data Flow

```
Create Tip
    ↓
Validate Repository & Recipient
    ↓
Create Escrow (optional: auto)
    ↓
Fund Escrow (transfer payment)
    ↓
Lock Escrow (ready for settlement)
    ↓
Release Funds (settlement complete)
```

### State Transitions

```
pending
    ↓
escrow_created
    ↓
funded
    ↓
locked
    ↓
released ← settlement complete

(can cancel from: pending, escrow_created, funded, locked)
```

## API Endpoints

### POST /a2a/github-tip
Create a new GitHub tip

**Request:**
```json
{
  "githubRepo": "owner/repo",
  "tipper": "agent-id or 0x...",
  "recipient": "github-username or 0x...",
  "amount": 100,
  "token": "SHIB|USDC",
  "message": "Optional tip message",
  "issueUrl": "https://github.com/...",
  "commitRef": "abc123...",
  "autoEscrow": true,
  "autoFund": false
}
```

**Response:**
```json
{
  "success": true,
  "tip": { /* tip object */ },
  "escrow": { /* escrow object */ }
}
```

### POST /a2a/github-tip/:tipId/fund
Fund an existing tip's escrow

### POST /a2a/github-tip/:tipId/lock
Lock a funded escrow (ready for release)

### POST /a2a/github-tip/:tipId/release
Release funds to recipient

### POST /a2a/github-tip/:tipId/cancel
Cancel a tip (refund to tipper)

### GET /a2a/github-tip/:tipId
Get tip details

### GET /a2a/github-tips
List tips with filters
- Query params: `githubRepo`, `tipper`, `recipient`, `state`, `token`, `minAmount`, `limit`

### GET /a2a/github-tips/repo/:owner/:repo
Get repository tipping statistics

### GET /a2a/github-tips/tipper/:tipper
Get tipper statistics

### GET /a2a/github-tips/stats
Get global tipping statistics

### POST /a2a/github-tips/batch-process
Process batch of tips for settlement

## Usage Examples

### JavaScript - Simple Tip

```javascript
const response = await fetch('http://localhost:8003/a2a/github-tip', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    githubRepo: 'ethereum/go-ethereum',
    tipper: 'agent-alice',
    recipient: 'vitalik.eth',
    amount: 1000,
    token: 'SHIB',
    message: 'Great consensus work!'
  })
});

const result = await response.json();
console.log('Tip:', result.tip.id);
```

### JavaScript - With Auto-Escrow and Funding

```javascript
const response = await fetch('http://localhost:8003/a2a/github-tip', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    githubRepo: 'uniswap/v3-core',
    tipper: '0x1234...5678',
    recipient: 'uniswap-dao',
    amount: 500,
    token: 'USDC',
    autoEscrow: true,
    autoFund: true
  })
});

const { tip, escrow } = await response.json();
console.log('Tip funded with escrow:', escrow.escrowId);
```

### Python - Repository Statistics

```python
import requests

response = requests.get(
    'http://localhost:8003/a2a/github-tips/repo/ethereum/go-ethereum'
)

stats = response.json()['stats']
print(f"Repository: {stats['githubRepo']}")
print(f"Total tips: {stats['totalTips']}")
print(f"Total amount: {stats['totalAmount']}")
print(f"By token: {stats['byToken']}")
```

### LangChain Integration

```typescript
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const githubTippingTool = new DynamicStructuredTool({
  name: "tip_github_repo",
  description: "Tip a GitHub repository with SHIB or USDC",
  schema: z.object({
    repo: z.string().describe("GitHub repo: owner/repo"),
    amount: z.number().describe("Tip amount"),
    token: z.enum(["SHIB", "USDC"]).describe("Token type"),
    message: z.string().describe("Optional tip message")
  }),
  func: async (input) => {
    const response = await fetch('http://localhost:8003/a2a/github-tip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        githubRepo: input.repo,
        tipper: process.env.AGENT_ID,
        recipient: 'recipient-address',
        amount: input.amount,
        token: input.token,
        message: input.message,
        autoEscrow: true
      })
    });
    
    const data = await response.json();
    return `Tip created: ${data.tip.id}`;
  }
});
```

## Installation

### 1. Add to package.json

```json
{
  "dependencies": {
    "ethers": "^6.13.0",
    "express": "^5.2.1"
  }
}
```

### 2. Initialize in Your Application

```javascript
const { GitHubTippingSystem } = require('./github-tipping');
const { EscrowSystem } = require('./escrow');
const { createGitHubTippingWebhook } = require('./github-tipping-webhook');
const express = require('express');

// Initialize systems
const escrow = new EscrowSystem('./escrow-state.json');
const tipping = new GitHubTippingSystem(escrow, './github-tips.json');

// Create Express app
const app = express();

// Mount webhook endpoints
const webhookRouter = createGitHubTippingWebhook(tipping, escrow);
app.use('/', webhookRouter);

// Start server
app.listen(8003, () => {
  console.log('GitHub Tipping API ready at http://localhost:8003');
});
```

### 3. Optional: Payment Handler

```javascript
const paymentHandler = async (tipData) => {
  // Process actual payment (e.g., via Web3)
  const tx = await sendPayment(
    tipData.recipient,
    tipData.amount,
    tipData.token
  );
  
  return {
    success: true,
    txHash: tx.hash,
    blockNumber: tx.blockNumber
  };
};

const webhookRouter = createGitHubTippingWebhook(
  tipping,
  escrow,
  paymentHandler
);
```

## Testing

Run the test suite:

```bash
npm run test:github-tipping
```

Or run all tests:

```bash
npm test
```

### Test Coverage

The test suite includes 22 comprehensive test cases:

- ✅ System initialization
- ✅ Repository validation (format, naming rules)
- ✅ Recipient validation (GitHub username, ETH address)
- ✅ Tip creation with all token types
- ✅ Input validation (amount, token)
- ✅ State transitions (pending → escrow_created → funded → locked → released)
- ✅ Escrow integration
- ✅ Filtering and listing tips
- ✅ Repository statistics
- ✅ Tipper statistics
- ✅ Global statistics
- ✅ Tip cancellation
- ✅ Batch processing
- ✅ GitHub metadata storage (issue URLs, commit refs)

## Data Storage

### Tips Storage Format

Tips are stored in JSON format (default: `./github-tips.json`):

```json
{
  "tip_abc123...": {
    "id": "tip_abc123...",
    "github": {
      "repo": "owner/repo",
      "owner": "owner",
      "repoName": "repo",
      "issueUrl": null,
      "commitRef": null,
      "timestamp": 1707542400000
    },
    "tipper": "agent-1",
    "recipient": "vitalik.eth",
    "recipientType": "ethereum",
    "amount": 1000,
    "token": "SHIB",
    "message": "Great work!",
    "state": "released",
    "escrowId": "esc_def456...",
    "timeline": {
      "created": 1707542400000,
      "escrowCreated": 1707542410000,
      "funded": 1707542420000,
      "locked": 1707542430000,
      "released": 1707542440000
    },
    "settlement": {
      "txHash": "0xabc...",
      "blockNumber": 12345678,
      "gasUsed": 50000,
      "timestamp": 1707542440000
    }
  }
}
```

## Statistics & Analytics

### Repository Statistics

```json
{
  "githubRepo": "ethereum/go-ethereum",
  "totalTips": 15,
  "releasedTips": 12,
  "totalAmount": 5000,
  "releasedAmount": 4500,
  "byToken": {
    "SHIB": { "count": 10, "total": 3000 },
    "USDC": { "count": 5, "total": 2000 }
  },
  "byState": {
    "released": 12,
    "locked": 2,
    "funded": 1,
    "pending": 0
  },
  "averageTip": "333.33"
}
```

### Global Statistics

Includes top 10 repositories by tip amount, token distribution, and state summary.

## Security Considerations

### 1. Input Validation

- GitHub repository format: `owner/repo` (alphanumeric + hyphens)
- Recipient: GitHub username or valid Ethereum address (0x...)
- Amount: Must be positive number
- Token: Only SHIB and USDC supported

### 2. Escrow Integration

- All tips backed by time-locked escrow
- 24-hour default timeout with automatic refund
- Requires approval from both tipper and recipient
- Dispute resolution supported via arbiters

### 3. State Management

- Immutable tip history
- All state transitions logged with timestamps
- Transaction hashes recorded for on-chain verification
- Gas usage tracked for transparency

### 4. Rate Limiting (Optional)

When deploying to production, consider:

```javascript
const rateLimit = require('express-rate-limit');

const tipLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,              // 10 tips per minute
  message: 'Too many tips created, please try again later.'
});

app.post('/a2a/github-tip', tipLimiter, (req, res) => {
  // Handle tip creation
});
```

## Production Deployment

### 1. Environment Variables

```bash
# .env.local
ESCROW_STATE_FILE=./data/escrow-state.json
GITHUB_TIPS_FILE=./data/github-tips.json
GITHUB_TIPPING_PORT=8003
NODE_ENV=production
```

### 2. Logging

```javascript
// Add structured logging
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/github-tipping.log' })
  ]
});

// Log tip creation
logger.info('Tip created', {
  tipId: tip.id,
  repo: tip.github.repo,
  amount: tip.amount,
  token: tip.token
});
```

### 3. Database Backup

```bash
# Backup tip data before deployments
cp ./github-tips.json ./backups/github-tips-$(date +%s).json
cp ./escrow-state.json ./backups/escrow-state-$(date +%s).json
```

### 4. Monitoring

Monitor these metrics:
- Total tips per hour
- Average tip amount
- Tips by token type
- Escrow creation success rate
- Settlement completion rate

## Integration Examples

### With Reputation System

```javascript
// Reward maintainers with reputation points for receiving tips
const reputation = new ReputationSystem();

tipping.onWebhookTip(async (event, tipData) => {
  if (event === 'released') {
    await reputation.recordAction({
      agent: tipData.recipient,
      action: 'received-github-tip',
      value: tipData.amount,
      context: `Tipped on ${tipData.github.repo}`
    });
  }
});
```

### With Discord Notifications

```javascript
// Notify on Discord when tips are released
const discord = require('discord.js');
const client = new discord.Client();

tipping.onWebhookTip(async (event, tipData) => {
  if (event === 'released') {
    await client.channels.cache.get(channelId).send(
      `✨ ${tipData.recipient} received a ${tipData.amount} ${tipData.token} tip on ${tipData.github.repo}!`
    );
  }
});
```

### With GitHub Actions

```yaml
# .github/workflows/post-release-tip.yml
name: Post Release Tip

on:
  release:
    types: [published]

jobs:
  tip:
    runs-on: ubuntu-latest
    steps:
      - name: Post GitHub Tip
        run: |
          curl -X POST http://localhost:8003/a2a/github-tip \
            -H "Content-Type: application/json" \
            -d '{
              "githubRepo": "${{ github.repository }}",
              "tipper": "github-actions",
              "recipient": "${{ github.repository_owner }}",
              "amount": 100,
              "token": "SHIB",
              "message": "Release published: ${{ github.event.release.tag_name }}"
            }'
```

## Troubleshooting

### Tip Creation Fails with "Invalid recipient"

**Cause:** Recipient format not recognized

**Solution:** Use either:
- GitHub username (alphanumeric + hyphens): `vitalik-buterin`
- Ethereum address (0x + 40 hex): `0x1234567890123456789012345678901234567890`

### "Escrow not found" Error

**Cause:** Tip created but escrow creation failed or was skipped

**Solution:** 
- Verify tip has `escrowId` set
- Create escrow manually via `/a2a/github-tip/:tipId/fund`
- Check escrow system logs

### Settlement Timing Out

**Cause:** Escrow timeout (default 24 hours)

**Solution:**
- Release funds before timeout
- Increase timeout when creating escrow: `timeoutMinutes: 2880` (48 hours)

## Contributing

To contribute improvements:

1. Fork the repository
2. Create feature branch: `git checkout -b feature/github-tipping-enhancement`
3. Add tests for new functionality
4. Update documentation
5. Submit pull request

## License

MIT - See LICENSE file for details

## Support

For issues or questions:
- Open an issue on GitHub
- Contact: support@a2a-payments.dev
- Discord: [A2A Payments Community](https://discord.gg/a2a-payments)
