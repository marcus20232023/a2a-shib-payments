# A2A Marketplace Integration Guide

Complete guide to integrating the a2a-payments escrow system with an A2A marketplace.

## Overview

The marketplace adapter bridges trustless escrow payments with service discovery and listing. It enables:

- **Service Registration**: Providers list services with pricing and terms
- **Service Discovery**: Buyers search and discover services via A2A protocol
- **Purchase Orders**: Formal purchase agreements with escrow backing
- **x402 Payment Headers**: Micro-payment protocol integration for HTTP-based services
- **Settlement**: Automatic escrow release on delivery or timeout
- **Multi-Token Support**: SHIB, USDC, and extensible token support

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  A2A Marketplace                     │
├─────────────────────────────────────────────────────┤
│  ServiceDefinition → Service Catalog → Purchase Order │
└────────────────────┬────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
    ┌────▼─────────┐    ┌────────▼──────┐
    │   Escrow     │    │   x402        │
    │   System     │    │   Headers     │
    └────┬─────────┘    └────────┬──────┘
         │                       │
         └───────────┬───────────┘
                     │
         ┌───────────▼────────────┐
         │  Blockchain Payment    │
         │  (SHIB/USDC/etc)      │
         └───────────────────────┘
```

## Core Components

### 1. ServiceDefinition
Represents a marketable service with pricing and terms.

```javascript
const service = new ServiceDefinition({
  providerId: 'agent-data',
  name: 'Market Data Feed',
  description: 'Real-time stock data',
  category: 'data',
  basePrice: 100,
  token: 'SHIB',
  paymentInterval: 'recurring', // one-time, recurring, metered
  deliveryTime: 5, // minutes
  qualityLevel: 'premium',
  refundPolicy: 'full-7d'
});
```

### 2. PurchaseOrder
Represents a formal purchase agreement.

```javascript
const po = new PurchaseOrder({
  buyerId: 'agent-trader',
  serviceId: 'svc_xxx',
  providerId: 'agent-data',
  quantity: 1
});

// State transitions: draft → pending → delivered → completed
```

### 3. MarketplaceAdapter
Main orchestrator connecting all systems.

```javascript
const marketplace = new MarketplaceAdapter({
  escrowSystem,
  paymentNegotiationSystem,
  storePath: './marketplace-state.json'
});
```

## Usage Flow

### Step 1: Register Services

```javascript
// Provider registers a service
const service = marketplace.registerService({
  providerId: 'agent-analyst',
  name: 'Portfolio Analysis',
  description: 'AI-powered portfolio optimization',
  category: 'analysis',
  basePrice: 500,
  token: 'SHIB',
  deliveryTime: 30,
  qualityLevel: 'enterprise'
});

console.log(`Service registered: ${service.id}`);
```

### Step 2: Discover Services

```javascript
// Search by category
const dataServices = marketplace.searchServices('data');

// Filter by price and quality
const premiumServices = marketplace.searchServices('analysis', {
  minPrice: 100,
  maxPrice: 1000,
  qualityLevel: 'enterprise'
});

// Export A2A-compatible catalog for discovery protocol
const a2aCatalog = marketplace.exportA2ACatalog('agent-analyst');
// Can publish to a2a-market discovery service
```

### Step 3: Create Purchase Order

```javascript
// Buyer creates PO
const po = marketplace.createPurchaseOrder({
  buyerId: 'agent-trader',
  serviceId: service.id,
  quantity: 1,
  customPrice: 450 // optional price override
});

console.log(`Purchase order created: ${po.id}, state: ${po.state}`);
```

### Step 4: Accept & Create Escrow

```javascript
// Buyer accepts the offer, escrow created
const result = marketplace.acceptPurchaseOrder(po.id);

console.log(`Escrow created: ${result.escrow.id}`);
console.log(`x402 Header signature: ${result.x402Header.signature}`);

// At this point:
// - PO state changes to 'pending'
// - Escrow is created in 'pending' state
// - x402 headers generated for HTTP middleware
// - Payment quote created via payment negotiation system
```

### Step 5: Generate x402 Headers

The x402 protocol enables trustless micro-payments via HTTP headers.

```javascript
// Get HTTP headers for inclusion in requests
const headers = marketplace.createX402PaymentHeaders(escrowId);

// Headers for API requests:
// x402-escrow-id: esc_xxx...
// x402-provider: agent-analyst
// x402-amount: 500
// x402-token: SHIB
// x402-signature: hash...
// x402-expires: 2026-02-15T10:00:00Z

// Verify signature in middleware
const isValid = marketplace.verifyX402Signature(
  escrowId,
  500,
  'SHIB',
  signature
);
```

### Step 6: Fund & Approve Escrow

Buyer funds the escrow (on-chain transaction):

```javascript
// After buyer sends SHIB to contract:
escrowSystem.fund(escrowId, txHash);

// Both parties approve (normally buyer + provider)
escrowSystem.approve(escrowId, buyerId);
escrowSystem.approve(escrowId, providerId);

// Escrow now in 'locked' state, waiting for delivery
```

### Step 7: Confirm Delivery & Release

Provider submits delivery proof:

```javascript
// Provider submits proof (data/file/signature)
marketplace.confirmDelivery({
  escrowId,
  poId,
  deliveryProof: 'ipfs://QmXxx... or provider_signature',
  buyerSignature: 'buyer_signature' // optional
});

// Result: Escrow released to provider, PO marked 'completed'
```

### Step 8: Settlement & Analytics

```javascript
// Get settlement records
const settlement = marketplace.state.settlements[escrowId];
// {
//   escrowId, poId, type: 'delivered',
//   timestamp, amount, token, status: 'completed'
// }

// Marketplace analytics
const stats = marketplace.getStats();
// {
//   totalServices, totalProviders, categories,
//   totalPurchaseOrders, totalSettlements,
//   totalValueSettled, ordersByState
// }
```

## Refunds & Cancellations

```javascript
// Cancel PO and refund escrow
marketplace.cancelPurchaseOrder(poId, 'Changed my mind');

// Escrow must be in refundable state (funded or locked)
// Automatic refund to buyer with timeout (typically 30-60 days post-request)
```

## Integration with A2A Protocol

### Advertising Services via A2A

The marketplace can export services as A2A capabilities:

```javascript
const a2aCatalog = marketplace.exportA2ACatalog();

// Output is A2A-compatible:
{
  "services": [
    {
      "name": "service_svc_xxx",
      "description": "Real-time market data",
      "category": "data",
      "provider": "agent-data-provider",
      "price": { "amount": 100, "token": "SHIB", "interval": "recurring" },
      "payment_method": "x402-escrow",
      "delivery": { "timeMinutes": 5, "qualityLevel": "premium" }
    }
  ]
}
```

This can be published to:
- A2A discovery services (a2a-market/jamjamzxhy)
- Agent marketplace platforms
- IPFS/DHT for decentralized discovery

### Requesting Service via A2A

```javascript
// Buyer agent requests service
const quoteRequest = {
  service: 'data_feed',
  provider: 'agent-data-provider',
  terms: {
    quantity: 1,
    deliveryTime: 5,
    maxPrice: 150
  }
};

// Provider returns quote with escrow terms
const quote = marketplace.paymentNegotiationSystem.createQuote({
  providerId: 'agent-data-provider',
  clientId: 'agent-trader',
  service: 'Market Data Feed',
  price: 100,
  token: 'SHIB'
});

// Buyer accepts → Purchase order + escrow created
marketplace.acceptPurchaseOrder(po.id);
```

## Multi-Token Support

The adapter automatically handles different token types:

```javascript
// Register service in USDC
const usdcService = marketplace.registerService({
  name: 'Premium Analysis',
  basePrice: 50,
  token: 'USDC' // Different token
  // ... other fields
});

// Escrow system detects token type and:
// - Marks USDC for ERC20 approval flow
// - Uses appropriate token adapter (erc20-usdc)
// - Handles decimals (6 for USDC vs 18 for most)
```

## x402 Micro-Payment Protocol

x402 is HTTP-based payment signaling for micro-payments:

```
GET /api/data HTTP/1.1
Host: provider.agent
x402-escrow-id: esc_xxx
x402-provider: agent-analyst
x402-amount: 100
x402-token: SHIB
x402-signature: hash
x402-expires: 2026-02-15T10:00:00Z

// Provider responds with payment required:
HTTP/402 Payment Required
x402-escrow-id: esc_xxx
x402-payment-status: pending

// If payment confirmed:
HTTP/200 OK
Content-Type: application/json
```

### Implementing x402 Middleware

```javascript
// Express middleware example
app.use((req, res, next) => {
  const escrowId = req.headers['x402-escrow-id'];
  if (!escrowId) return next();

  const escrow = escrowSystem.get(escrowId);
  if (!escrow) return res.status(402).send('Invalid escrow');

  // Verify signature
  const isValid = marketplace.verifyX402Signature(
    escrowId,
    req.headers['x402-amount'],
    req.headers['x402-token'],
    req.headers['x402-signature']
  );

  if (!isValid) return res.status(402).send('Invalid signature');

  // Check escrow is locked (payment confirmed)
  if (escrow.state !== 'locked') {
    return res.status(402).send('Payment not confirmed');
  }

  // Payment valid, allow request
  next();
});
```

## State Persistence

All state is automatically persisted to JSON files:

```
marketplace-state.json    - Services, POs, settlements
escrow-state.json         - Escrow records
negotiation-state.json    - Quotes and negotiations
```

For production, consider:
- Database backend (PostgreSQL/MongoDB)
- Replicated state stores
- Audit logging

## Monitoring & Analytics

```javascript
// Get comprehensive stats
const stats = marketplace.getStats();

// Monitor key metrics:
// - totalValueSettled: Total payment settled (in token units)
// - ordersByState: Distribution of PO states
// - categories: Available service categories
// - totalProviders: Number of active service providers

// Track individual settlements
const settlement = marketplace.state.settlements[escrowId];
// Can be used for:
// - Revenue tracking
// - Provider rankings
// - Market analytics
```

## Error Handling

Common scenarios:

```javascript
try {
  // Try to release escrow before delivery
  escrowSystem.release(escrowId);
} catch (e) {
  if (e.message.includes('Delivery proof required')) {
    // Submit delivery proof first
    escrowSystem.submitDelivery(escrowId, {...});
    escrowSystem.release(escrowId);
  }
}

try {
  // Try to cancel already-completed PO
  marketplace.cancelPurchaseOrder(poId);
} catch (e) {
  // PO can't be cancelled in completed state
  // Refund policy determines options
}
```

## Best Practices

### For Providers
1. Set reasonable delivery times to reduce buyer risk
2. Offer refund policies to build trust
3. Register multiple service tiers (standard/premium/enterprise)
4. Update service descriptions to reflect quality

### For Buyers
1. Check provider reputation before purchasing
2. Always provide delivery proof signatures
3. Use custom prices only when negotiating with provider
4. Monitor escrow state for timeout risk

### For Marketplace Operators
1. Implement arbiter system for dispute resolution
2. Monitor settlement velocity and value metrics
3. Implement rate limiting on service lookups
4. Use x402 middleware to enforce payment collection
5. Regular backups of state files
6. Consider blockchain settlement for high-value transactions

## Advanced Topics

### Custom Settlement Logic

Extend MarketplaceAdapter for custom settlement:

```javascript
class CustomMarketplace extends MarketplaceAdapter {
  async settleWithBlockchain(escrowId, txHash) {
    // Write to smart contract
    // Update settlement record
    // Emit event
  }
}
```

### Service Quality Tiers

```javascript
const basicService = marketplace.registerService({
  name: 'Basic Data',
  qualityLevel: 'standard',
  basePrice: 50
});

const premiumService = marketplace.registerService({
  name: 'Premium Data',
  qualityLevel: 'premium',
  basePrice: 150
});

const enterpriseService = marketplace.registerService({
  name: 'Enterprise Data',
  qualityLevel: 'enterprise',
  basePrice: 500
});
```

### Recurring Payments

```javascript
const recurringService = marketplace.registerService({
  name: 'Monthly Data Feed',
  paymentInterval: 'recurring',
  basePrice: 100,
  metadata: {
    billingCycle: 'monthly',
    autoRenewal: true,
    cancellationPolicy: '30-day notice'
  }
});

// Create monthly subscription via repeated POs
for (let month = 0; month < 12; month++) {
  marketplace.createPurchaseOrder({
    buyerId: 'agent-trader',
    serviceId: recurringService.id
  });
}
```

## Testing

Run the comprehensive integration test:

```bash
node test/test-marketplace-integration.js
```

This validates:
- Service registration and discovery
- A2A capability export
- Purchase order lifecycle
- Escrow creation and settlement
- x402 header generation
- Multi-order handling
- Refunds and cancellations
- State persistence and recovery

## Security Considerations

1. **Signature Verification**: Always verify x402 signatures
2. **Payment Confirmation**: Require escrow to be 'locked' before serving
3. **Timeout Protection**: Auto-refund prevents funds lock-up
4. **Delivery Proof**: Store cryptographically signed proofs
5. **Rate Limiting**: Prevent abuse of service discovery
6. **Access Control**: Providers can only modify own services

## Performance Notes

- Service lookup: O(1) by ID, O(n) for search
- Purchase orders: O(1) CRUD operations
- Escrow state transitions: O(1) with JSON persistence
- A2A export: O(n) but cached in practice
- x402 verification: O(1) hash comparison

For production with thousands of services/orders:
- Consider database indices
- Implement caching layer
- Use message queues for settlement processing

## Future Enhancements

- [ ] Reputation/rating system integration
- [ ] Multi-signature escrow for complex transactions
- [ ] Time-locked contracts with automated execution
- [ ] Service upgrade/downgrade workflows
- [ ] Partial refund support
- [ ] Subscription management
- [ ] Provider insurance pool
- [ ] Marketplace fees/commission tracking
- [ ] SLA (Service Level Agreement) enforcement
- [ ] Decentralized arbiter network

## References

- [A2A Protocol](https://github.com/a2a-js/sdk)
- [x402 Specification](https://httpwg.org/http-extensions/draft-faltstrom-http-extensions-rest.html)
- [Escrow System Guide](./ESCROW-NEGOTIATION-GUIDE.md)
- [Integration Examples](./INTEGRATION-EXAMPLES.md)

## Support

For issues or questions:
1. Check test/test-marketplace-integration.js for examples
2. Review INTEGRATION-EXAMPLES.md for common patterns
3. File issues on GitHub with marketplace-related tags

---

**Last Updated**: 2026-02-12
**Version**: 1.0.0
**Status**: Production Ready
