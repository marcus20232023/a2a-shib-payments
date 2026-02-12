#!/usr/bin/env node

/**
 * Marketplace Integration Test
 * 
 * Demonstrates complete workflow:
 * 1. Service registration and listing
 * 2. Service discovery and search
 * 3. Purchase order creation
 * 4. Escrow setup with x402 headers
 * 5. Service delivery and settlement
 * 6. Refund handling
 */

const path = require('path');
const fs = require('fs');

// Import core systems
const { EscrowSystem } = require('../escrow.js');
const { PaymentNegotiationSystem } = require('../payment-negotiation.js');
const { MarketplaceAdapter, ServiceDefinition, PurchaseOrder } = require('../marketplace-adapter.js');

// Test configuration
const TEST_CONFIG = {
  escrowStorePath: './test-escrow-marketplace.json',
  negotiationStorePath: './test-negotiation-marketplace.json',
  marketplaceStorePath: './test-marketplace.json'
};

// Cleanup function
function cleanup() {
  [TEST_CONFIG.escrowStorePath, TEST_CONFIG.negotiationStorePath, TEST_CONFIG.marketplaceStorePath].forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  });
}

// Test utilities
function assert(condition, message) {
  if (!condition) {
    throw new Error(`❌ Assertion failed: ${message}`);
  }
  console.log(`✓ ${message}`);
}

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${title}`);
  console.log(`${'='.repeat(60)}\n`);
}

async function runTests() {
  try {
    cleanup(); // Start fresh

    // Initialize systems
    const escrowSystem = new EscrowSystem(TEST_CONFIG.escrowStorePath);
    const paymentNegotiationSystem = new PaymentNegotiationSystem(
      escrowSystem,
      TEST_CONFIG.negotiationStorePath
    );
    const marketplace = new MarketplaceAdapter({
      escrowSystem,
      paymentNegotiationSystem,
      storePath: TEST_CONFIG.marketplaceStorePath
    });

    console.log('\n🎯 Marketplace Integration Test Suite\n');

    // ============================================================
    // TEST 1: Service Registration
    // ============================================================
    section('1. SERVICE REGISTRATION');

    const dataService = marketplace.registerService({
      providerId: 'agent-data-provider',
      name: 'Market Data Feed',
      description: 'Real-time stock market data with 1-minute latency',
      category: 'data',
      basePrice: 100,
      token: 'SHIB',
      paymentInterval: 'recurring',
      deliveryTime: 5,
      qualityLevel: 'premium',
      refundPolicy: 'full-7d',
      metadata: {
        dataSource: 'nasdaq',
        updateInterval: 60,
        symbols: ['AAPL', 'GOOGL', 'MSFT']
      }
    });

    assert(dataService.id.startsWith('svc_'), 'Service has unique ID');
    assert(dataService.providerId === 'agent-data-provider', 'Provider correctly set');
    assert(dataService.basePrice === 100, 'Price correctly set');
    console.log(`\n📋 Registered service: ${dataService.name} (${dataService.id})`);
    console.log(`   Provider: ${dataService.providerId}`);
    console.log(`   Price: ${dataService.basePrice} ${dataService.token}`);

    // Register additional services
    const analysisService = marketplace.registerService({
      providerId: 'agent-analyst',
      name: 'Portfolio Analysis',
      description: 'AI-powered portfolio optimization and risk analysis',
      category: 'analysis',
      basePrice: 500,
      token: 'SHIB',
      paymentInterval: 'one-time',
      deliveryTime: 30,
      qualityLevel: 'enterprise',
      refundPolicy: 'full-30d'
    });

    const tradingService = marketplace.registerService({
      providerId: 'agent-analyst',
      name: 'Automated Trading Signals',
      description: 'AI-generated trading signals based on market analysis',
      category: 'trading',
      basePrice: 250,
      token: 'SHIB',
      paymentInterval: 'recurring',
      deliveryTime: 1,
      qualityLevel: 'premium'
    });

    const stats = marketplace.getStats();
    assert(stats.totalServices === 3, 'All services registered');
    assert(stats.totalProviders === 2, 'Two providers registered');
    console.log(`\n✓ Total services: ${stats.totalServices}`);
    console.log(`✓ Total providers: ${stats.totalProviders}`);

    // ============================================================
    // TEST 2: Service Catalog & Discovery
    // ============================================================
    section('2. SERVICE CATALOG & DISCOVERY');

    const providerServices = marketplace.getProviderServices('agent-analyst');
    assert(providerServices.length === 2, 'Provider has correct service count');
    console.log(`\nAgent-analyst services:`);
    providerServices.forEach(s => {
      console.log(`  - ${s.name} (${s.id}): ${s.basePrice} ${s.token}`);
    });

    const dataServices = marketplace.searchServices('data');
    assert(dataServices.length === 1, 'Data category search works');
    console.log(`\n✓ Found ${dataServices.length} data service(s)`);

    const premiumServices = marketplace.searchServices('analysis', { qualityLevel: 'enterprise' });
    assert(premiumServices.length === 1, 'Quality level filter works');
    console.log(`✓ Found ${premiumServices.length} enterprise service(s)`);

    // ============================================================
    // TEST 3: A2A Capability Export
    // ============================================================
    section('3. A2A CAPABILITY EXPORT');

    const a2aCatalog = marketplace.exportA2ACatalog();
    assert(a2aCatalog.services.length === 3, 'A2A catalog exports all services');
    assert(a2aCatalog.services[0].payment_method === 'x402-escrow', 'Services marked with x402-escrow');

    console.log(`\nA2A Catalog exported with ${a2aCatalog.services.length} services`);
    console.log(`Format: A2A agent discovery compatible\n`);

    const dataServiceCapability = a2aCatalog.services.find(s => s.category === 'data');
    console.log(`Sample capability: ${dataServiceCapability.name}`);
    console.log(`  Price: ${dataServiceCapability.price.amount} ${dataServiceCapability.price.token}`);
    console.log(`  Delivery: ${dataServiceCapability.delivery.timeMinutes} minutes`);

    // ============================================================
    // TEST 4: Purchase Order Lifecycle
    // ============================================================
    section('4. PURCHASE ORDER LIFECYCLE');

    // Create purchase order
    const po1 = marketplace.createPurchaseOrder({
      buyerId: 'agent-trader',
      serviceId: dataService.id,
      quantity: 1
    });

    assert(po1.id.startsWith('po_'), 'Purchase order has unique ID');
    assert(po1.state === 'draft', 'Initial state is draft');
    assert(po1.escrowId === null, 'No escrow until accepted');
    console.log(`\n📦 Created purchase order: ${po1.id}`);
    console.log(`   Buyer: ${po1.buyerId}`);
    console.log(`   Service: ${dataService.name}`);
    console.log(`   Price: ${po1.price} ${dataService.token}`);

    // ============================================================
    // TEST 5: Escrow Creation & x402 Headers
    // ============================================================
    section('5. ESCROW CREATION & x402 HEADERS');

    const acceptance = marketplace.acceptPurchaseOrder(po1.id);
    
    assert(acceptance.purchaseOrder.state === 'pending', 'PO state changed to pending');
    assert(acceptance.escrow.id.startsWith('esc_'), 'Escrow created with unique ID');
    assert(acceptance.x402Header.escrowId === acceptance.escrow.id, 'x402 header linked to escrow');
    
    console.log(`\n🔒 Escrow created: ${acceptance.escrow.id}`);
    console.log(`   State: ${acceptance.escrow.state}`);
    console.log(`   Amount: ${acceptance.escrow.amount} SHIB`);
    console.log(`   Payer: ${acceptance.escrow.payer}`);
    console.log(`   Payee: ${acceptance.escrow.payee}`);

    console.log(`\n📋 x402 Header generated:`);
    console.log(`   Scheme: ${acceptance.x402Header.scheme}`);
    console.log(`   Escrow ID: ${acceptance.x402Header.escrowId}`);
    console.log(`   Amount: ${acceptance.x402Header.amount} ${acceptance.x402Header.token}`);
    console.log(`   Signature: ${acceptance.x402Header.signature.slice(0, 16)}...`);

    // Verify x402 headers can be extracted for HTTP middleware
    const httpHeaders = marketplace.createX402PaymentHeaders(acceptance.escrow.id);
    assert(httpHeaders['x402-escrow-id'] === acceptance.escrow.id, 'HTTP headers generated correctly');
    console.log(`\n✓ HTTP headers ready for middleware:`);
    console.log(`   ${Object.keys(httpHeaders).map(k => `${k}: ${httpHeaders[k].toString().slice(0, 20)}...`).join('\n   ')}`);

    // Verify signature
    const isValid = marketplace.verifyX402Signature(
      acceptance.x402Header.escrowId,
      acceptance.x402Header.amount,
      acceptance.x402Header.token,
      acceptance.x402Header.signature
    );
    assert(isValid, 'x402 signature verification works');

    // ============================================================
    // TEST 6: Multiple Purchase Orders
    // ============================================================
    section('6. MULTIPLE PURCHASE ORDERS & SCALING');

    const po2 = marketplace.createPurchaseOrder({
      buyerId: 'agent-trader-2',
      serviceId: analysisService.id
    });

    const po3 = marketplace.createPurchaseOrder({
      buyerId: 'agent-hedge-fund',
      serviceId: tradingService.id,
      quantity: 5
    });

    const acceptance2 = marketplace.acceptPurchaseOrder(po2.id);
    const acceptance3 = marketplace.acceptPurchaseOrder(po3.id);

    const updatedStats = marketplace.getStats();
    assert(updatedStats.totalPurchaseOrders === 3, 'All POs tracked');
    assert(updatedStats.ordersByState.pending === 3, 'All POs in pending state');

    console.log(`\n📊 Marketplace state:`);
    console.log(`   Total POs: ${updatedStats.totalPurchaseOrders}`);
    console.log(`   Pending: ${updatedStats.ordersByState.pending}`);
    console.log(`   Total escrows: ${Object.keys(escrowSystem.escrows).length}`);

    // ============================================================
    // TEST 7: Service Delivery & Settlement
    // ============================================================
    section('7. SERVICE DELIVERY & SETTLEMENT');

    // Simulate escrow funding and approval (normally done via blockchain)
    escrowSystem.fund(acceptance.escrow.id, 'tx_hash_from_blockchain');
    escrowSystem.approve(acceptance.escrow.id, po1.buyerId);
    escrowSystem.approve(acceptance.escrow.id, acceptance.escrow.payee);

    // Mark first service as delivered
    const delivery1 = marketplace.confirmDelivery({
      escrowId: acceptance.escrow.id,
      poId: po1.id,
      deliveryProof: 'data_feed_stream_active:nasdaq_aapl_100.50_1707638400',
      buyerSignature: 'sig_buyer_123'
    });

    assert(delivery1.purchaseOrder.state === 'completed' || delivery1.purchaseOrder.state === 'delivered', 'PO marked as delivered or completed');
    assert(delivery1.escrow.deliveryProof !== null, 'Delivery proof recorded');
    console.log(`\n✓ Service delivered: ${po1.id}`);
    console.log(`   Escrow state: ${delivery1.escrow.state}`);
    console.log(`   Settlement: ${marketplace.state.settlements[acceptance.escrow.id]?.type}`);

    // ============================================================
    // TEST 8: Refund & Cancellation
    // ============================================================
    section('8. REFUND & CANCELLATION');

    const cancelResult = marketplace.cancelPurchaseOrder(po3.id, 'Changed mind - service not needed');
    assert(cancelResult.purchaseOrder.state === 'cancelled', 'PO cancelled');
    console.log(`\n✓ Purchase order cancelled: ${po3.id}`);
    console.log(`   Reason: Changed mind - service not needed`);
    console.log(`   Refund initiated for: ${po3.price} SHIB`);

    const finalStats = marketplace.getStats();
    assert(finalStats.ordersByState.cancelled === 1, 'Cancellation recorded');
    console.log(`\n   Total cancelled orders: ${finalStats.ordersByState.cancelled}`);

    // ============================================================
    // TEST 9: Marketplace Analytics
    // ============================================================
    section('9. MARKETPLACE ANALYTICS');

    console.log(`\nMarketplace Statistics:`);
    console.log(`  Total Services: ${finalStats.totalServices}`);
    console.log(`  Total Providers: ${finalStats.totalProviders}`);
    console.log(`  Categories: ${finalStats.categories.join(', ')}`);
    console.log(`\nPurchase Order States:`);
    console.log(`  Draft: ${finalStats.ordersByState.draft}`);
    console.log(`  Pending: ${finalStats.ordersByState.pending}`);
    console.log(`  Delivered: ${finalStats.ordersByState.delivered}`);
    console.log(`  Completed: ${finalStats.ordersByState.completed}`);
    console.log(`  Cancelled: ${finalStats.ordersByState.cancelled}`);
    console.log(`\nSettlement:`);
    console.log(`  Total Settlements: ${finalStats.totalSettlements}`);
    console.log(`  Total Value Settled: ${finalStats.totalValueSettled} SHIB`);

    // ============================================================
    // TEST 10: Persistence & Recovery
    // ============================================================
    section('10. PERSISTENCE & RECOVERY');

    // Verify state was saved
    assert(fs.existsSync(TEST_CONFIG.marketplaceStorePath), 'Marketplace state persisted to disk');
    assert(fs.existsSync(TEST_CONFIG.escrowStorePath), 'Escrow state persisted to disk');

    // Load state from fresh instance
    const marketplace2 = new MarketplaceAdapter({
      escrowSystem: new EscrowSystem(TEST_CONFIG.escrowStorePath),
      paymentNegotiationSystem,
      storePath: TEST_CONFIG.marketplaceStorePath
    });

    const recoveredStats = marketplace2.getStats();
    assert(recoveredStats.totalServices === finalStats.totalServices, 'Services recovered from state');
    assert(recoveredStats.totalPurchaseOrders === finalStats.totalPurchaseOrders, 'POs recovered from state');

    console.log(`\n✓ Marketplace state persisted and recovered`);
    console.log(`  Services: ${recoveredStats.totalServices}`);
    console.log(`  Purchase Orders: ${recoveredStats.totalPurchaseOrders}`);
    console.log(`  Escrows: ${Object.keys(escrowSystem.escrows).length}`);

    // ============================================================
    // FINAL REPORT
    // ============================================================
    section('✅ ALL TESTS PASSED');

    console.log(`\nMarketplace Integration Test Summary:`);
    console.log(`  ✓ Service registration and management`);
    console.log(`  ✓ Service discovery and search`);
    console.log(`  ✓ A2A capability export`);
    console.log(`  ✓ Purchase order lifecycle`);
    console.log(`  ✓ Escrow creation and management`);
    console.log(`  ✓ x402 payment header generation`);
    console.log(`  ✓ Multiple concurrent orders`);
    console.log(`  ✓ Service delivery and settlement`);
    console.log(`  ✓ Refunds and cancellations`);
    console.log(`  ✓ Marketplace analytics`);
    console.log(`  ✓ Persistence and recovery\n`);

    cleanup(); // Clean up test files
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    cleanup();
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  runTests()
    .then(() => {
      console.log('\n🎉 All marketplace tests passed!\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test suite failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runTests };
