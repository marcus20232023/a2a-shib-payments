# Event Webhooks System

## Overview

The Event Webhooks system allows external applications to subscribe to and receive real-time notifications about payment events in the A2A Payments system. This enables seamless integration with notification systems, logging platforms, and automation services.

## Features

✅ **Webhook Registration** - Register URLs to receive specific events  
✅ **Reliable Delivery** - Automatic retries with exponential backoff  
✅ **Signature Verification** - HMAC-SHA256 signing for security  
✅ **Event Filtering** - Subscribe to specific event types  
✅ **History & Logs** - Track all webhook deliveries and events  
✅ **Management API** - Full CRUD operations for webhooks  
✅ **Test Delivery** - Test webhooks before deploying  
✅ **Statistics & Monitoring** - Track success rates and performance  

## Supported Events

### Escrow Events
- **escrow_created** - New escrow created for payment
- **escrow_funded** - Escrow has been funded with payment
- **escrow_locked** - Escrow locked and ready for release
- **escrow_released** - Funds released to payee
- **escrow_refunded** - Escrow refunded to payer
- **escrow_disputed** - Dispute opened on escrow

### Tipping Events
- **tipping_received** - Tip received by agent
- **payment_settled** - Payment settlement completed

## Quick Start

### 1. Register a Webhook

```javascript
const { WebhookManager } = require('./event-webhooks');

const webhooks = new WebhookManager();

const webhook = webhooks.register(
  'https://your-api.com/webhooks/payments',
  ['escrow_created', 'escrow_released'],
  {
    description: 'Payment notifications',
    headers: { 'Authorization': 'Bearer token_123' }
  }
);

console.log('Webhook ID:', webhook.webhookId);
console.log('Secret:', webhook.secret);  // Save this securely!
```

### 2. Receive Webhook Events

Set up an HTTP endpoint to receive POST requests:

```javascript
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = 'your_webhook_secret_here';

app.post('/webhooks/payments', (req, res) => {
  // Verify signature
  const signature = req.headers['x-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (!crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  console.log(`Received ${event.type} event:`, event.data);

  // Process event
  res.json({ received: true });
});

app.listen(3000);
```

### 3. Example Event Payload

```json
{
  "id": "evt_abc123def456",
  "type": "escrow_created",
  "timestamp": 1707619200000,
  "data": {
    "escrowId": "esc_xyz789",
    "payer": "agent-1",
    "payee": "agent-2",
    "amount": 1000,
    "token": "SHIB",
    "purpose": "Payment for services"
  },
  "context": {
    "service": "a2a-payments"
  }
}
```

## Webhook Headers

All webhook requests include security headers:

```
Content-Type: application/json
X-Webhook-ID: wh_xxxxxxxxxxxxx
X-Event-ID: evt_xxxxxxxxxxxxx
X-Event-Type: escrow_created
X-Timestamp: 1234567890
X-Signature: sha256_hmac_signature
```

## Retry Logic

Failed deliveries are automatically retried with exponential backoff:

```
Attempt 1: Immediate
Attempt 2: 1 second delay
Attempt 3: 2 second delay
Attempt 4: 4 second delay
Attempt 5: 8 second delay
```

Configuration:

```javascript
const webhooks = new WebhookManager();

webhooks.config.maxRetries = 5;              // Max retry attempts
webhooks.config.initialDelayMs = 1000;       // Initial delay (1 second)
webhooks.config.maxDelayMs = 3600000;        // Max delay (1 hour)
webhooks.config.backoffMultiplier = 2;       // Exponential multiplier
webhooks.config.requestTimeoutMs = 10000;    // Request timeout (10 seconds)
```

## API Reference

### WebhookManager

#### Constructor
```javascript
const webhooks = new WebhookManager(
  storePath = './webhooks-state.json',
  logsPath = './webhooks-logs.json'
);
```

#### register(url, eventTypes, options)
Register a webhook to receive events.

**Parameters:**
- `url` (string) - HTTPS URL to send events to
- `eventTypes` (string[]) - Array of event types to listen for
- `options` (object) - Optional: `description`, `headers`

**Returns:** `{ webhookId, secret, url, eventTypes, createdAt }`

```javascript
const webhook = webhooks.register(
  'https://api.example.com/webhooks',
  ['escrow_created', 'escrow_released'],
  { description: 'My webhook' }
);
```

#### unregister(webhookId)
Unregister a webhook.

```javascript
webhooks.unregister(webhook.webhookId);
```

#### update(webhookId, updates)
Update webhook configuration.

```javascript
webhooks.update(webhook.webhookId, {
  eventTypes: ['escrow_created', 'escrow_disputed'],
  enabled: false
});
```

#### get(webhookId)
Get webhook details.

```javascript
const webhook = webhooks.get(webhookId);
```

#### list(filters)
List webhooks with optional filtering.

```javascript
// All webhooks
webhooks.list();

// Filter by event type
webhooks.list({ eventType: 'escrow_created' });

// Filter by enabled status
webhooks.list({ enabled: true });
```

#### emit(eventType, eventData, context)
Emit an event to all matching webhooks.

```javascript
await webhooks.emit('escrow_created', {
  escrowId: 'esc_123',
  payer: 'agent-1',
  payee: 'agent-2',
  amount: 1000
});
```

#### getHistory(webhookId, limit)
Get webhook delivery history.

```javascript
const history = webhooks.getHistory(webhookId, 100);
history.forEach(entry => {
  console.log(entry.type, entry.timestamp, entry.data);
});
```

#### getStats(webhookId)
Get webhook statistics.

```javascript
const stats = webhooks.getStats();
console.log(`Total webhooks: ${stats.total}`);
console.log(`Enabled: ${stats.enabled}`);
console.log(`Success rate: ${stats.successRate}%`);
```

#### testWebhook(webhookId)
Test webhook delivery.

```javascript
const result = await webhooks.testWebhook(webhookId);
if (result.success) {
  console.log('Webhook is working!');
}
```

#### verifySignature(webhookId, event, signature)
Verify webhook signature.

```javascript
const isValid = webhooks.verifySignature(webhookId, event, signature);
```

#### clearOldLogs(daysOld)
Clear logs older than specified days.

```javascript
webhooks.clearOldLogs(30);  // Clear logs older than 30 days
```

## Integration with Escrow System

The webhook system integrates seamlessly with the escrow system:

```javascript
const { EscrowWithWebhooks } = require('./escrow-webhook-integration');
const { WebhookManager } = require('./event-webhooks');

const webhooks = new WebhookManager();
const escrow = new EscrowWithWebhooks('./escrow-state.json', webhooks);

// Events are automatically emitted
const escrowData = escrow.create({
  payer: 'agent-1',
  payee: 'agent-2',
  amount: 1000,
  purpose: 'Payment'
});
// Automatically emits: escrow_created
```

## Integration with Tipping System

The webhook system integrates with the tipping system:

```javascript
const { TippingWithWebhooks } = require('./tipping-webhook-integration');
const { WebhookManager } = require('./event-webhooks');

const webhooks = new WebhookManager();
const tipping = new TippingWithWebhooks('./tips-state.json', webhooks);

// Events are automatically emitted
const tip = tipping.create({
  sender: 'agent-1',
  recipient: 'agent-2',
  amount: 100,
  reason: 'Great work!'
});
// Automatically emits: tip_created
```

## Security

### Signature Verification

Always verify webhook signatures in your endpoint:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### Secret Management

1. Store webhook secrets securely in environment variables
2. Never commit secrets to version control
3. Rotate secrets periodically
4. Use HTTPS endpoints only
5. Validate SSL certificates

### Rate Limiting

Implement rate limiting on your webhook endpoint:

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 1000,    // 1 minute
  max: 100                // Max 100 requests per minute
});

app.post('/webhooks/payments', limiter, (req, res) => {
  // Handle webhook
});
```

## Best Practices

### 1. Always Verify Signatures

```javascript
app.post('/webhook', (req, res) => {
  if (!verifySignature(req.body, req.headers['x-signature'], WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  // Process event
});
```

### 2. Respond Quickly

```javascript
app.post('/webhook', (req, res) => {
  // Respond immediately
  res.json({ received: true });
  
  // Process asynchronously
  processEventAsync(req.body).catch(error => {
    console.error('Failed to process event:', error);
  });
});
```

### 3. Idempotent Processing

```javascript
const processedEvents = new Set();

app.post('/webhook', (req, res) => {
  const eventId = req.body.id;
  
  if (processedEvents.has(eventId)) {
    return res.json({ received: true });  // Already processed
  }
  
  processEvent(req.body);
  processedEvents.add(eventId);
  
  res.json({ received: true });
});
```

### 4. Monitor Health

```javascript
app.get('/health', (req, res) => {
  const stats = webhooks.getStats();
  
  const healthy = stats.totalSuccess > 0 && 
                  (stats.totalSuccess / (stats.totalSuccess + stats.totalFailures) > 0.95);
  
  res.json({
    status: healthy ? 'healthy' : 'degraded',
    stats
  });
});
```

## Troubleshooting

### Webhook Not Receiving Events

1. Check webhook is enabled: `webhooks.list({ enabled: true })`
2. Check event types: `webhook.eventTypes` includes the event
3. Test webhook: `await webhooks.testWebhook(webhookId)`
4. Check logs: `webhooks.getHistory(webhookId)`

### Signature Verification Failing

1. Ensure correct webhook secret is used
2. Verify JSON stringification matches exactly
3. Check for JSON formatting differences
4. Test with example event

### Retries Not Working

1. Check webhook URL is correct and responding
2. Verify HTTPS certificate is valid
3. Check firewall/network connectivity
4. Review logs for error messages

## Monitoring and Analytics

### Track Success Rate

```javascript
const stats = webhooks.getStats();
console.log(`Success rate: ${stats.totalSuccess / (stats.totalSuccess + stats.totalFailures) * 100}%`);
```

### Monitor Event Flow

```javascript
webhooks.on('webhook_delivered', (entry) => {
  console.log(`Delivered to ${entry.data.webhookId}`);
});

webhooks.on('webhook_delivery_failed_retry', (entry) => {
  console.log(`Retry scheduled for ${entry.data.webhookId}`);
});
```

### Export Metrics

```javascript
const stats = webhooks.getStats();
const metricsJson = JSON.stringify(stats, null, 2);
fs.writeFileSync('./webhook-metrics.json', metricsJson);
```

## Testing

Run the comprehensive test suite:

```bash
node test/test-event-webhooks.js
```

Tests cover:
- ✅ Webhook registration and management
- ✅ Event emission and delivery
- ✅ Retry logic with exponential backoff
- ✅ Signature verification
- ✅ Webhook history and logs
- ✅ Error handling and edge cases
- ✅ Integration with escrow and tipping systems

## Examples

See [INTEGRATION-EXAMPLES.md](INTEGRATION-EXAMPLES.md) for:
- Discord notifications
- Email alerts
- Logging services
- Database integration
- API management examples

## Support

For issues, feature requests, or questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Review [test cases](test/test-event-webhooks.js)
3. Check [integration examples](INTEGRATION-EXAMPLES.md)
4. Open an issue on GitHub

## License

Same as parent project - See [LICENSE](LICENSE)
