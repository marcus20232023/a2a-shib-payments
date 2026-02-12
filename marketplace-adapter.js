/**
 * Marketplace Adapter for A2A Payments
 * 
 * Bridges a2a-payments escrow system with A2A marketplace protocol
 * Enables trustless service listing, discovery, and payment settlement
 * 
 * Architecture:
 * - Service Catalog: Store service definitions with pricing and terms
 * - Listing Protocol: Advertise services via A2A agent discovery
 * - Purchase Flow: Service selection → escrow creation → x402 headers → delivery
 * - Settlement: Automatic escrow release on delivery confirmation or timeout
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Service Definition
 * Defines a marketable service with pricing, terms, and delivery requirements
 */
class ServiceDefinition {
  constructor({
    id,
    providerId,
    name,
    description,
    category,
    basePrice,
    token = 'SHIB',
    paymentInterval = 'one-time', // one-time, recurring, metered
    deliveryTime = null, // Minutes
    qualityLevel = 'standard', // standard, premium, enterprise
    cancellable = true,
    refundPolicy = 'full-30d',
    metadata = {}
  }) {
    this.id = id || 'svc_' + crypto.randomBytes(8).toString('hex');
    this.providerId = providerId;
    this.name = name;
    this.description = description;
    this.category = category;
    this.basePrice = basePrice;
    this.token = token;
    this.paymentInterval = paymentInterval;
    this.deliveryTime = deliveryTime;
    this.qualityLevel = qualityLevel;
    this.cancellable = cancellable;
    this.refundPolicy = refundPolicy;
    this.metadata = metadata;
    this.createdAt = new Date().toISOString();
  }

  // Convert to A2A capability advertisement
  toA2ACapability() {
    return {
      name: `service_${this.id}`,
      description: this.description,
      category: this.category,
      provider: this.providerId,
      price: {
        amount: this.basePrice,
        token: this.token,
        interval: this.paymentInterval
      },
      delivery: {
        timeMinutes: this.deliveryTime,
        qualityLevel: this.qualityLevel
      },
      terms: {
        refundPolicy: this.refundPolicy,
        cancellable: this.cancellable
      },
      payment_method: 'x402-escrow', // Indicates x402 + escrow
      metadata: this.metadata
    };
  }

  // Convert to OpenAPI/REST schema for marketplace listing
  toMarketplaceSchema() {
    return {
      type: 'object',
      properties: {
        service_id: {
          type: 'string',
          description: `ID of service (${this.id})`,
          const: this.id
        },
        quantity: {
          type: 'number',
          description: 'Quantity or units of service',
          minimum: 1
        },
        duration: {
          type: 'number',
          description: 'Duration in minutes (if applicable)'
        }
      },
      required: ['service_id']
    };
  }
}

/**
 * Marketplace Purchase Order
 * Created when a buyer wants to purchase a service
 */
class PurchaseOrder {
  constructor({
    id,
    buyerId,
    serviceId,
    providerId,
    quantity = 1,
    price = null,
    terms = {}
  }) {
    this.id = id || 'po_' + crypto.randomBytes(8).toString('hex');
    this.buyerId = buyerId;
    this.serviceId = serviceId;
    this.providerId = providerId;
    this.quantity = quantity;
    this.price = price; // Override base price if different
    this.terms = terms;
    this.state = 'draft'; // draft → pending → confirmed → paid → delivered → completed
    this.escrowId = null;
    this.deliveryProof = null;
    this.createdAt = new Date().toISOString();
    this.acceptedAt = null;
    this.timeline = {
      created: Date.now(),
      submitted: null,
      confirmed: null,
      paid: null,
      delivered: null,
      completed: null
    };
  }
}

/**
 * Marketplace Adapter
 * Main orchestrator for service listing, discovery, purchasing, and settlement
 */
class MarketplaceAdapter {
  constructor({
    escrowSystem,
    paymentNegotiationSystem,
    storePath = './marketplace-state.json'
  }) {
    this.escrowSystem = escrowSystem;
    this.paymentNegotiationSystem = paymentNegotiationSystem;
    this.storePath = storePath;

    this.state = {
      services: {}, // serviceId → ServiceDefinition
      catalog: {}, // providerId → [serviceIds]
      purchaseOrders: {}, // poId → PurchaseOrder
      settlements: {}, // escrowId → settlement record
      x402Headers: {} // escrowId → x402 header data
    };

    this.loadState();

    // x402 Payment Protocol support
    this.x402Config = {
      version: '1.0',
      headerName: 'WWW-Authenticate',
      paymentScheme: 'x402-escrow'
    };
  }

  loadState() {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, 'utf8');
        this.state = JSON.parse(data);
      }
    } catch (e) {
      console.warn('Could not load marketplace state:', e.message);
    }
  }

  saveState() {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.error('Error saving marketplace state:', e.message);
    }
  }

  /**
   * Register a new service in the marketplace
   */
  registerService(serviceParams) {
    const service = new ServiceDefinition(serviceParams);
    this.state.services[service.id] = service;

    // Index by provider
    if (!this.state.catalog[service.providerId]) {
      this.state.catalog[service.providerId] = [];
    }
    this.state.catalog[service.providerId].push(service.id);

    this.saveState();
    return service;
  }

  /**
   * Get service by ID
   */
  getService(serviceId) {
    return this.state.services[serviceId];
  }

  /**
   * Get all services for a provider
   */
  getProviderServices(providerId) {
    const serviceIds = this.state.catalog[providerId] || [];
    return serviceIds.map(id => this.state.services[id]);
  }

  /**
   * Search services by category
   */
  searchServices(category, filters = {}) {
    const results = Object.values(this.state.services).filter(service => {
      if (service.category !== category) return false;

      // Apply filters
      if (filters.minPrice && service.basePrice < filters.minPrice) return false;
      if (filters.maxPrice && service.basePrice > filters.maxPrice) return false;
      if (filters.provider && service.providerId !== filters.provider) return false;
      if (filters.qualityLevel && service.qualityLevel !== filters.qualityLevel) return false;

      return true;
    });

    return results;
  }

  /**
   * Create purchase order for a service
   * Leads to escrow creation and x402 header generation
   */
  createPurchaseOrder({
    buyerId,
    serviceId,
    quantity = 1,
    customPrice = null
  }) {
    const service = this.getService(serviceId);
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    const po = new PurchaseOrder({
      buyerId,
      serviceId,
      providerId: service.providerId,
      quantity,
      price: customPrice || service.basePrice
    });

    this.state.purchaseOrders[po.id] = po;
    this.saveState();

    return po;
  }

  /**
   * Accept purchase order and create escrow
   * This transitions PO to "pending" and sets up payment
   */
  acceptPurchaseOrder(poId, buyerAddress = null) {
    const po = this.state.purchaseOrders[poId];
    if (!po) {
      throw new Error(`Purchase order not found: ${poId}`);
    }

    if (po.state !== 'draft') {
      throw new Error(`Cannot accept PO in state: ${po.state}`);
    }

    const service = this.getService(po.serviceId);

    // Create escrow through payment negotiation system
    const quote = this.paymentNegotiationSystem.createQuote({
      providerId: service.providerId,
      clientId: po.buyerId,
      service: service.name,
      price: po.price,
      token: service.token,
      terms: {
        deliveryTimeMinutes: service.deliveryTime,
        qualityGuarantee: service.qualityLevel,
        refundPolicy: service.refundPolicy,
        escrowRequired: true
      }
    });

    // Accept the quote to move to escrow creation
    const accepted = this.paymentNegotiationSystem.accept(
      quote.id,
      po.buyerId
    );

    // Create escrow
    const escrow = this.escrowSystem.create({
      payer: po.buyerId,
      payee: service.providerId,
      amount: po.price,
      purpose: `Service purchase: ${service.name}`,
      token: service.token,
      conditions: {
        requiresDelivery: true,
        deliveryDescription: service.name,
        deliveryDeadline: service.deliveryTime
      },
      timeoutMinutes: service.deliveryTime ? service.deliveryTime + 60 : 1440
    });

    // Link escrow to PO
    po.escrowId = escrow.id;
    po.state = 'pending';
    po.timeline.submitted = Date.now();

    // Generate x402 header
    const x402Header = this.generateX402Header({
      escrowId: escrow.id,
      providerId: service.providerId,
      amount: po.price,
      token: service.token,
      serviceId: po.serviceId
    });

    this.state.x402Headers[escrow.id] = x402Header;
    this.state.purchaseOrders[poId] = po;
    this.saveState();

    return {
      purchaseOrder: po,
      escrow,
      quote,
      x402Header
    };
  }

  /**
   * Generate x402 Payment header for micro-payments
   * Enables HTTP-header-based payment signaling
   * 
   * Format: x402-escrow <escrowId>;<paymentAddress>;<amount>;<token>
   */
  generateX402Header({ escrowId, providerId, amount, token, serviceId }) {
    const header = {
      scheme: this.x402Config.paymentScheme,
      escrowId,
      provider: providerId,
      amount,
      token,
      serviceId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h expiry
      signature: this.createX402Signature(escrowId, amount, token)
    };

    return header;
  }

  /**
   * Create cryptographic signature for x402 header
   * Enables secure micropayment verification
   */
  createX402Signature(escrowId, amount, token) {
    const data = `${escrowId}:${amount}:${token}:${Math.floor(Date.now() / 1000)}`;
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return hash;
  }

  /**
   * Confirm delivery of service
   * Releases escrow and completes purchase order
   */
  confirmDelivery({
    escrowId,
    poId,
    deliveryProof,
    buyerSignature = null
  }) {
    const po = this.state.purchaseOrders[poId];
    if (!po) {
      throw new Error(`Purchase order not found: ${poId}`);
    }

    if (po.escrowId !== escrowId) {
      throw new Error(`Escrow mismatch for PO ${poId}`);
    }

    // Provide delivery proof to escrow
    const escrow = this.escrowSystem.escrows[escrowId];
    if (!escrow) {
      throw new Error(`Escrow not found: ${escrowId}`);
    }

    // Submit delivery proof
    this.escrowSystem.submitDelivery(escrowId, {
      submittedBy: 'buyer',
      data: deliveryProof,
      signature: buyerSignature
    });

    // Try to release escrow
    try {
      const released = this.escrowSystem.release(escrowId, 'delivery confirmed');
      po.state = released.state === 'released' ? 'completed' : 'delivered';
      po.timeline.delivered = Date.now();
      if (po.state === 'completed') {
        po.timeline.completed = Date.now();
        this.recordSettlement(escrowId, poId, 'delivered');
      }
    } catch (e) {
      // Escrow requires additional approvals
      po.state = 'delivered';
      po.timeline.delivered = Date.now();
    }

    this.state.purchaseOrders[poId] = po;
    this.saveState();

    return {
      purchaseOrder: po,
      escrow,
      status: 'delivery_confirmed'
    };
  }

  /**
   * Cancel purchase order and refund
   */
  cancelPurchaseOrder(poId, reason) {
    const po = this.state.purchaseOrders[poId];
    if (!po) {
      throw new Error(`Purchase order not found: ${poId}`);
    }

    if (po.escrowId) {
      // Refund from escrow
      try {
        this.escrowSystem.refund(po.escrowId, reason);
        this.recordSettlement(po.escrowId, poId, 'refunded');
      } catch (e) {
        // Escrow might already be released
        console.warn(`Could not refund escrow ${po.escrowId}: ${e.message}`);
      }
    }

    po.state = 'cancelled';
    this.state.purchaseOrders[poId] = po;
    this.saveState();

    return { purchaseOrder: po, status: 'cancelled' };
  }

  /**
   * Record settlement when escrow is released or refunded
   */
  recordSettlement(escrowId, poId, settlementType) {
    const escrow = this.escrowSystem.escrows[escrowId];
    if (!escrow) return;

    const settlement = {
      escrowId,
      poId,
      type: settlementType, // delivered, refunded, disputed
      timestamp: Date.now(),
      amount: escrow.amount,
      token: escrow.metadata?.token || 'SHIB',
      txHash: escrow.txHash,
      status: settlementType === 'delivered' ? 'completed' : 'pending'
    };

    this.state.settlements[escrowId] = settlement;
    this.saveState();

    return settlement;
  }

  /**
   * Get marketplace statistics
   */
  getStats() {
    const services = Object.values(this.state.services);
    const pos = Object.values(this.state.purchaseOrders);
    const settlements = Object.values(this.state.settlements);

    return {
      totalServices: services.length,
      totalProviders: Object.keys(this.state.catalog).length,
      categories: [...new Set(services.map(s => s.category))],
      totalPurchaseOrders: pos.length,
      totalSettlements: settlements.length,
      totalValueSettled: settlements.reduce((sum, s) => sum + s.amount, 0),
      ordersByState: {
        draft: pos.filter(p => p.state === 'draft').length,
        pending: pos.filter(p => p.state === 'pending').length,
        delivered: pos.filter(p => p.state === 'delivered').length,
        completed: pos.filter(p => p.state === 'completed').length,
        cancelled: pos.filter(p => p.state === 'cancelled').length
      }
    };
  }

  /**
   * Export marketplace catalog in A2A discovery format
   * Can be published to marketplace protocol/discovery service
   */
  exportA2ACatalog(providerId = null) {
    let services = Object.values(this.state.services);
    if (providerId) {
      services = services.filter(s => s.providerId === providerId);
    }

    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      services: services.map(s => s.toA2ACapability())
    };
  }

  /**
   * Create HTTP response headers for x402 payment flow
   * Can be used in middleware to signal payment requirements
   */
  createX402PaymentHeaders(escrowId) {
    const header = this.state.x402Headers[escrowId];
    if (!header) {
      throw new Error(`No x402 header found for escrow: ${escrowId}`);
    }

    return {
      'x402-escrow-id': header.escrowId,
      'x402-provider': header.provider,
      'x402-amount': header.amount.toString(),
      'x402-token': header.token,
      'x402-signature': header.signature,
      'x402-expires': header.expiresAt
    };
  }

  /**
   * Verify x402 header signature
   * Used to validate payment headers in requests
   */
  verifyX402Signature(escrowId, amount, token, signature) {
    const expectedSig = this.createX402Signature(escrowId, amount, token);
    return expectedSig === signature;
  }
}

module.exports = {
  MarketplaceAdapter,
  ServiceDefinition,
  PurchaseOrder
};
