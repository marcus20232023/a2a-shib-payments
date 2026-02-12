# Integration Examples

This document shows how to integrate the A2A SHIB Payment Agent with popular AI agent frameworks.

---

## 🦜 LangChain Integration

### Python Example

```python
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain.tools import Tool
from langchain_openai import ChatOpenAI
import requests

# A2A Payment Tool
def call_payment_agent(query: str) -> str:
    """Send a message to the A2A SHIB payment agent"""
    response = requests.post(
        "http://localhost:8003/a2a/jsonrpc",
        json={
            "jsonrpc": "2.0",
            "method": "message/send",
            "params": {
                "message": {
                    "kind": "message",
                    "messageId": "langchain-1",
                    "role": "user",
                    "parts": [{"kind": "text", "text": query}]
                }
            },
            "id": 1
        }
    )
    return response.json()["result"]["parts"][0]["text"]

payment_tool = Tool(
    name="A2A_Payment_Agent",
    func=call_payment_agent,
    description="Send SHIB payments, create escrows, negotiate prices, check reputation"
)

# Create LangChain agent with payment capability
llm = ChatOpenAI(model="gpt-4")
agent = create_openai_functions_agent(llm, [payment_tool], system_message)
agent_executor = AgentExecutor(agent=agent, tools=[payment_tool])

# Use it
result = agent_executor.invoke({"input": "Check my SHIB balance"})
print(result["output"])

result = agent_executor.invoke({
    "input": "Create an escrow for 500 SHIB to pay data-agent for market data"
})
print(result["output"])
```

### JavaScript/TypeScript Example

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// A2A Payment Tool
const paymentTool = new DynamicStructuredTool({
  name: "a2a_payment_agent",
  description: "Send SHIB payments, create escrows, negotiate prices, check reputation",
  schema: z.object({
    query: z.string().describe("The payment-related query or command"),
  }),
  func: async ({ query }) => {
    const response = await fetch("http://localhost:8003/a2a/jsonrpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "message/send",
        params: {
          message: {
            kind: "message",
            messageId: "langchain-1",
            role: "user",
            parts: [{ kind: "text", text: query }]
          }
        },
        id: 1
      })
    });
    const data = await response.json();
    return data.result.parts[0].text;
  }
});

// Create agent
const model = new ChatOpenAI({ modelName: "gpt-4" });
const agent = await createOpenAIFunctionsAgent({
  llm: model,
  tools: [paymentTool],
  prompt: systemPrompt
});

const executor = new AgentExecutor({ agent, tools: [paymentTool] });

// Use it
const result = await executor.invoke({
  input: "Create an escrow for 500 SHIB to pay data-agent"
});
console.log(result.output);
```

---

## ☁️ AWS Bedrock Agents Integration

### Agent Action Group Configuration

```json
{
  "actionGroupName": "SHIBPaymentActions",
  "description": "SHIB payment, escrow, and reputation actions",
  "actionGroupExecutor": {
    "lambda": "arn:aws:lambda:us-east-1:123456789012:function:a2a-payment-proxy"
  },
  "apiSchema": {
    "payload": "..."
  }
}
```

### Lambda Proxy Function (Node.js)

```javascript
const fetch = require('node-fetch');

exports.handler = async (event) => {
  const { apiPath, requestBody } = event;
  
  // Map Bedrock action to A2A command
  let command = '';
  switch (apiPath) {
    case '/payment/send':
      command = `send ${requestBody.amount} SHIB to ${requestBody.recipient}`;
      break;
    case '/escrow/create':
      command = `escrow create ${requestBody.amount} SHIB for ${requestBody.purpose} payee ${requestBody.payee}`;
      break;
    case '/reputation/check':
      command = `reputation check ${requestBody.agentId}`;
      break;
    default:
      return { statusCode: 400, body: 'Unknown action' };
  }

  // Call A2A agent
  const response = await fetch('http://your-agent:8003/a2a/jsonrpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          kind: 'message',
          messageId: event.messageId,
          role: 'user',
          parts: [{ kind: 'text', text: command }]
        }
      },
      id: 1
    })
  });

  const data = await response.json();
  
  return {
    statusCode: 200,
    body: {
      messageVersion: '1.0',
      response: {
        actionGroup: event.actionGroup,
        apiPath: event.apiPath,
        httpMethod: event.httpMethod,
        httpStatusCode: 200,
        responseBody: {
          'application/json': {
            body: data.result.parts[0].text
          }
        }
      }
    }
  };
};
```

### OpenAPI Schema for Bedrock

```yaml
openapi: 3.0.0
info:
  title: A2A SHIB Payment API
  version: 1.0.0
paths:
  /payment/send:
    post:
      summary: Send SHIB payment
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                amount:
                  type: number
                recipient:
                  type: string
      responses:
        '200':
          description: Payment sent
  /escrow/create:
    post:
      summary: Create escrow
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                amount:
                  type: number
                purpose:
                  type: string
                payee:
                  type: string
      responses:
        '200':
          description: Escrow created
  /reputation/check:
    post:
      summary: Check agent reputation
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                agentId:
                  type: string
      responses:
        '200':
          description: Reputation data
```

---

## 🦪 OpenClaw Integration

### As a Skill

The agent can be used as a standalone OpenClaw skill:

```bash
# Install in OpenClaw skills directory
cd ~/clawd/skills
git clone https://github.com/marcus20232023/a2a-payments.git shib-payments
cd shib-payments
npm install

# Configure
cp .env.example .env.local
nano .env.local  # Add wallet details

# Start
node a2a-agent-full.js
```

### SKILL.md Example

```markdown
# SKILL.md - SHIB Payment Agent

## Description
A2A protocol payment agent for SHIB on Polygon. Provides escrow, negotiation, and reputation services.

## Usage
The agent runs on port 8003. OpenClaw can communicate via A2A protocol.

## Commands
- `send [amount] SHIB to [address]` - Send payment
- `balance` - Check SHIB balance
- `escrow create [amount] SHIB for [purpose] payee [agent]` - Create escrow
- `reputation check [agentId]` - Check agent reputation

## Configuration
Set in `.env.local`:
- WALLET_PRIVATE_KEY
- RPC_URL (Polygon)
- SHIB_CONTRACT_ADDRESS

## Port
8003 (default)
```

---

## 🤖 AutoGen Integration

### Multi-Agent Setup

```python
import autogen
import requests

# A2A Payment Proxy Agent
payment_proxy = autogen.AssistantAgent(
    name="PaymentProxy",
    llm_config={"config_list": config_list},
    system_message="You handle payments via the A2A SHIB payment system."
)

def call_a2a_agent(message: str) -> str:
    response = requests.post(
        "http://localhost:8003/a2a/jsonrpc",
        json={
            "jsonrpc": "2.0",
            "method": "message/send",
            "params": {
                "message": {
                    "kind": "message",
                    "messageId": "autogen-1",
                    "role": "user",
                    "parts": [{"kind": "text", "text": message}]
                }
            },
            "id": 1
        }
    )
    return response.json()["result"]["parts"][0]["text"]

# Register A2A function
autogen.register_function(
    call_a2a_agent,
    caller=payment_proxy,
    executor=user_proxy,
    name="a2a_payment",
    description="Send SHIB payments, create escrows, check reputation"
)

# Use in conversation
user_proxy.initiate_chat(
    payment_proxy,
    message="Create an escrow for 500 SHIB to buy market data from data-agent"
)
```

---

## 🌐 Direct A2A Protocol Integration

### REST API

```bash
# Send message via REST
curl -X POST http://localhost:8003/a2a/rest/message/send \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "kind": "message",
      "messageId": "rest-1",
      "role": "user",
      "parts": [{"kind": "text", "text": "balance"}]
    }
  }'
```

### JSON-RPC

```javascript
const response = await fetch('http://localhost:8003/a2a/jsonrpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: 'custom-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'send 100 SHIB to 0x...' }]
      }
    },
    id: 1
  })
});

const data = await response.json();
console.log(data.result);
```

### Agent Discovery

```javascript
// Discover payment agent via A2A registry
const response = await fetch('http://localhost:8003/.well-known/agent-card.json');
const agentCard = await response.json();

console.log(agentCard.name);         // "SHIB Payment Agent"
console.log(agentCard.capabilities); // Payment, escrow, negotiation, reputation
console.log(agentCard.endpoints);    // A2A endpoints
```

---

## 📦 Docker Integration

### Docker Compose Multi-Agent Setup

```yaml
version: '3.8'
services:
  payment-agent:
    image: node:18
    working_dir: /app
    volumes:
      - ./a2a-payments:/app
    environment:
      - WALLET_PRIVATE_KEY=${WALLET_PRIVATE_KEY}
      - RPC_URL=https://polygon-rpc.com
    command: npm start
    ports:
      - "8003:8003"
    networks:
      - agent-network

  langchain-agent:
    image: python:3.11
    working_dir: /app
    volumes:
      - ./langchain-agent:/app
    environment:
      - A2A_PAYMENT_URL=http://payment-agent:8003
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    command: python agent.py
    networks:
      - agent-network
    depends_on:
      - payment-agent

networks:
  agent-network:
    driver: bridge
```

---

## 💰 GitHub Tipping Integration

The GitHub Tipping system allows agents and users to tip on GitHub repositories directly from code, using A2A escrow for secure payment settlement.

### Feature Highlights

- **Tip via API:** Create tips on any GitHub repository
- **Token Support:** SHIB or USDC
- **Escrow-backed:** Secure payment with conditions and settlement
- **Auto-funding:** Optional automatic escrow creation and funding
- **Statistics:** Real-time repo and tipper analytics
- **Webhook Integration:** Automated tip processing via webhooks

### Basic JavaScript/TypeScript Example

```typescript
import fetch from 'node-fetch';

// Create a GitHub tip
async function tipGitHubRepo() {
  const response = await fetch('http://localhost:8003/a2a/github-tip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      githubRepo: 'ethereum/go-ethereum',
      tipper: 'agent-123',
      recipient: 'vitalik-buterin',
      amount: 1000,
      token: 'SHIB',
      message: 'Great work on consensus improvements!',
      autoEscrow: true,
      autoFund: false  // Manual funding after this
    })
  });

  const result = await response.json();
  console.log('Tip created:', result.tip.id);
  console.log('Escrow:', result.escrow.escrowId);
  
  return result.tip.id;
}

// Tip with commit reference
async function tipForCommit() {
  const response = await fetch('http://localhost:8003/a2a/github-tip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      githubRepo: 'uniswap/v3-core',
      tipper: '0x1234567890123456789012345678901234567890',
      recipient: 'hayden.eth',
      amount: 500,
      token: 'USDC',
      message: 'Tipping for the V3 architecture improvements',
      commitRef: 'abc1234567890def1234567890def1234567890',
      autoEscrow: true,
      autoFund: true  // Automatic payment
    })
  });

  return await response.json();
}

// Fund an existing tip
async function fundTip(tipId: string, txHash: string) {
  const response = await fetch(
    `http://localhost:8003/a2a/github-tip/${tipId}/fund`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash })
    }
  );

  return await response.json();
}

// Lock escrow (ready for release)
async function lockTip(tipId: string) {
  const response = await fetch(
    `http://localhost:8003/a2a/github-tip/${tipId}/lock`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );

  return await response.json();
}

// Release funds to recipient
async function releaseTip(tipId: string, txHash: string, blockNumber: number) {
  const response = await fetch(
    `http://localhost:8003/a2a/github-tip/${tipId}/release`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash,
        blockNumber,
        gasUsed: 50000
      })
    }
  );

  return await response.json();
}

// List tips for a repository
async function getRepoStats(owner: string, repo: string) {
  const response = await fetch(
    `http://localhost:8003/a2a/github-tips/repo/${owner}/${repo}`,
    { method: 'GET' }
  );

  const data = await response.json();
  console.log(`Repo: ${owner}/${repo}`);
  console.log(`Total tips: ${data.stats.totalTips}`);
  console.log(`Total amount: ${data.stats.totalAmount} ${data.stats.byToken}`);
  
  return data;
}

// Get tipper statistics
async function getTipperStats(tipper: string) {
  const response = await fetch(
    `http://localhost:8003/a2a/github-tips/tipper/${tipper}`,
    { method: 'GET' }
  );

  return await response.json();
}

// Global statistics
async function getGlobalStats() {
  const response = await fetch(
    'http://localhost:8003/a2a/github-tips/stats',
    { method: 'GET' }
  );

  return await response.json();
}
```

### Python Example

```python
import requests
import json

# Base URL
BASE_URL = 'http://localhost:8003'

def create_github_tip(
    github_repo: str,
    tipper: str,
    recipient: str,
    amount: float,
    token: str = 'SHIB',
    message: str = None,
    auto_escrow: bool = True,
    auto_fund: bool = False
):
    """Create a GitHub tip with optional escrow"""
    response = requests.post(
        f'{BASE_URL}/a2a/github-tip',
        json={
            'githubRepo': github_repo,
            'tipper': tipper,
            'recipient': recipient,
            'amount': amount,
            'token': token,
            'message': message,
            'autoEscrow': auto_escrow,
            'autoFund': auto_fund
        }
    )
    response.raise_for_status()
    return response.json()

def list_repo_tips(
    github_repo: str,
    limit: int = 100,
    min_amount: float = None,
    token: str = None,
    state: str = None
):
    """List tips for a repository with filters"""
    params = {
        'githubRepo': github_repo,
        'limit': limit
    }
    if min_amount:
        params['minAmount'] = min_amount
    if token:
        params['token'] = token
    if state:
        params['state'] = state
    
    response = requests.get(
        f'{BASE_URL}/a2a/github-tips',
        params=params
    )
    response.raise_for_status()
    return response.json()

def get_repo_stats(owner: str, repo: str):
    """Get statistics for a GitHub repository"""
    response = requests.get(
        f'{BASE_URL}/a2a/github-tips/repo/{owner}/{repo}'
    )
    response.raise_for_status()
    return response.json()

def get_tipper_stats(tipper: str):
    """Get statistics for a tipper"""
    response = requests.get(
        f'{BASE_URL}/a2a/github-tips/tipper/{tipper}'
    )
    response.raise_for_status()
    return response.json()

# Example usage
if __name__ == '__main__':
    # Tip an Ethereum repository maintainer
    result = create_github_tip(
        github_repo='ethereum/go-ethereum',
        tipper='agent-alice',
        recipient='vitalik.eth',
        amount=1000,
        token='SHIB',
        message='Thanks for the latest consensus update!',
        auto_escrow=True
    )
    
    print(f"Tip created: {result['tip']['id']}")
    if 'escrow' in result:
        print(f"Escrow: {result['escrow']['escrowId']}")
    
    # Check repository stats
    stats = get_repo_stats('ethereum', 'go-ethereum')
    print(f"\nRepository: {stats['stats']['githubRepo']}")
    print(f"Total tips: {stats['stats']['totalTips']}")
    print(f"Total amount: {stats['stats']['totalAmount']}")
```

### Full Workflow Example

```javascript
// Complete workflow: Create → Escrow → Fund → Lock → Release

async function completeTippingWorkflow() {
  // 1. Create tip
  const createResp = await fetch('http://localhost:8003/a2a/github-tip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      githubRepo: 'ethereum/go-ethereum',
      tipper: '0x1234567890123456789012345678901234567890',
      recipient: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      amount: 100,
      token: 'SHIB',
      message: 'Funding consensus research',
      autoEscrow: true,
      autoFund: false  // We'll fund manually
    })
  });

  const { tip, escrow } = await createResp.json();
  console.log('✓ Tip created:', tip.id);
  console.log('✓ Escrow created:', escrow.escrowId);

  // 2. Process payment (your payment handler)
  const paymentTx = await processPaymentOnBlockchain(
    tip.tipper,
    tip.recipient,
    tip.amount,
    tip.token
  );
  console.log('✓ Payment processed:', paymentTx.hash);

  // 3. Fund the escrow
  const fundResp = await fetch(
    `http://localhost:8003/a2a/github-tip/${tip.id}/fund`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: paymentTx.hash })
    }
  );
  const fundedTip = await fundResp.json();
  console.log('✓ Escrow funded');

  // 4. Lock the escrow
  const lockResp = await fetch(
    `http://localhost:8003/a2a/github-tip/${tip.id}/lock`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  console.log('✓ Escrow locked');

  // 5. Release to recipient (after settlement conditions met)
  const releaseResp = await fetch(
    `http://localhost:8003/a2a/github-tip/${tip.id}/release`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: paymentTx.hash,
        blockNumber: paymentTx.blockNumber
      })
    }
  );
  const releasedTip = await releaseResp.json();
  console.log('✓ Funds released to recipient');

  return releasedTip;
}
```

### Integration with LangChain Agent

```typescript
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// GitHub Tipping Tool for LangChain
const githubTippingTool = new DynamicStructuredTool({
  name: "github_tipping",
  description: "Create and manage GitHub repository tips with escrow",
  schema: z.object({
    action: z.enum(["create", "list", "stats"]).describe("Action to perform"),
    githubRepo: z.string().optional().describe("GitHub repo (owner/repo)"),
    tipper: z.string().optional().describe("Tipper agent ID or address"),
    recipient: z.string().optional().describe("Recipient username or address"),
    amount: z.number().optional().describe("Tip amount"),
    token: z.enum(["SHIB", "USDC"]).optional().describe("Token type"),
    message: z.string().optional().describe("Tip message")
  }),
  func: async (input) => {
    const baseUrl = 'http://localhost:8003';

    if (input.action === 'create') {
      const response = await fetch(`${baseUrl}/a2a/github-tip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          githubRepo: input.githubRepo,
          tipper: input.tipper,
          recipient: input.recipient,
          amount: input.amount,
          token: input.token || 'SHIB',
          message: input.message,
          autoEscrow: true
        })
      });
      const data = await response.json();
      return `Tip created: ${data.tip.id} with escrow ${data.escrow?.escrowId || 'pending'}`;
    }

    if (input.action === 'list') {
      const params = new URLSearchParams({
        githubRepo: input.githubRepo || '',
        limit: '10'
      });
      const response = await fetch(`${baseUrl}/a2a/github-tips?${params}`);
      const data = await response.json();
      return `Found ${data.count} tips: ${JSON.stringify(data.tips.slice(0, 3))}`;
    }

    if (input.action === 'stats') {
      const response = await fetch(`${baseUrl}/a2a/github-tips/stats`);
      const data = await response.json();
      return `Global stats: ${data.stats.totalTips} tips, ${data.stats.totalAmount} total amount`;
    }

    return 'Unknown action';
  }
});

export { githubTippingTool };
```

---

## 🔒 Production Best Practices

### 1. Authentication

```javascript
// Add API key authentication
const response = await fetch('http://localhost:8003/a2a/jsonrpc', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.A2A_API_KEY
  },
  body: JSON.stringify({...})
});
```

### 2. Error Handling

```python
def safe_a2a_call(query: str, max_retries: int = 3) -> str:
    for attempt in range(max_retries):
        try:
            response = requests.post(
                "http://localhost:8003/a2a/jsonrpc",
                json={...},
                timeout=10
            )
            response.raise_for_status()
            return response.json()["result"]["parts"][0]["text"]
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)  # Exponential backoff
```

### 3. Rate Limiting

```javascript
// Respect rate limits (10 req/min by default)
import { RateLimiter } from 'limiter';

const limiter = new RateLimiter({
  tokensPerInterval: 10,
  interval: 'minute'
});

await limiter.removeTokens(1);
const result = await callA2AAgent(query);
```

---

## 📚 Additional Resources

- **A2A Protocol Spec:** https://a2a-protocol.org
- **Main Documentation:** [README.md](README.md)
- **API Reference:** [ESCROW-NEGOTIATION-GUIDE.md](ESCROW-NEGOTIATION-GUIDE.md)
- **Security Guide:** [PRODUCTION-HARDENING.md](PRODUCTION-HARDENING.md)
- **Deployment Options:** [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 🤝 Community Examples

Have an integration example for another framework? Submit a PR!

**Wanted:**
- CrewAI integration
- Semantic Kernel integration
- LlamaIndex integration
- Haystack integration

**Contributors:**
- *(Your name here!)*


### ERC-20 tokens

#### USDC (Amoy testnet)

We added a minimal ERC-20/USDC adapter in `adapters/erc20-usdc.js` and a read-only test in `test/test-usdc.js` which you can run to inspect token metadata (symbol/decimals) on Polygon Amoy testnet (Mumbai's successor).

Usage:

1. Install dependencies:

   cd /home/marc/projects/a2a-payments
   npm install

2. The test is pre-configured with an Amoy USDC token address: `0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582`. You can verify or change this in `test/test-usdc.js`.

3. Choose a reliable Amoy RPC provider. Public endpoints may require API keys; recommended options:
   - Alchemy: `https://polygon-amoy.g.alchemy.com/v2/<YOUR_KEY>`
   - Infura: `https://polygon-amoy.infura.io/v3/<YOUR_KEY>`
   - Ankr / Chainstack: provide your project-specific endpoint

4. Run the read-only test (no funds required):

   node test/test-usdc.js

Notes:
- If you see network/timeout/403 errors, it usually means the public RPC endpoint blocked requests or requires an API key — switch to your provider with a key.
- The adapter returns raw token units; USDC typically uses 6 decimals. Convert amounts accordingly when making transfers (e.g., `ethers.parseUnits('1.0', 6)`).
- For full integration tests that perform transfers, add a dedicated funded test wallet (do NOT commit private keys). Use local environment variables or a secrets vault for test keys.
