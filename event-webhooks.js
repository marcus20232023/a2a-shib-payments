/**
 * Event Webhooks System for A2A Payments
 * 
 * Allows external systems to listen to payment events via registered webhooks.
 * Features:
 * - Webhook registration/management
 * - Event delivery with retry logic
 * - Exponential backoff for failed deliveries
 * - Webhook history and logs
 * - Event filtering by type
 * - Queue persistence and durability
 * - Rehydration from disk on startup
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');

class WebhookManager extends EventEmitter {
  constructor(storePath = './webhooks-state.json', logsPath = './webhooks-logs.json', queuePath = './webhooks-queue.json') {
    super();
    this.storePath = storePath;
    this.logsPath = logsPath;
    this.queuePath = queuePath;
    this.webhooks = this.loadState();
    this.logs = this.loadLogs();
    
    // Queue durability: load persisted queue from disk
    this.deliveryQueue = this.loadQueue();
    
    // Configuration
    this.config = {
      maxRetries: 5,
      initialDelayMs: 1000,           // 1 second
      maxDelayMs: 3600000,            // 1 hour
      backoffMultiplier: 2,
      requestTimeoutMs: 10000,
      maxLogEntries: 10000,
      queueCheckpointIntervalMs: 5000  // Checkpoint queue every 5 seconds
    };

    // Queue processor state
    this.processingQueue = false;
    this.queueProcessorHandle = null;
    this.checkpointHandle = null;
    this.queueProcessingPromise = null;

    // Note: queueProcessingComplete event is emitted via super.emit() in processDeliveryQueue()

    // Start queue processor and checkpointing
    this.startQueueProcessor();
    this.startQueueCheckpointing();
  }

  /**
   * Load webhooks from storage
   */
  loadState() {
    if (fs.existsSync(this.storePath)) {
      try {
        const data = fs.readFileSync(this.storePath, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error loading webhooks state:', error);
        return {};
      }
    }
    return {};
  }

  /**
   * Load webhook logs
   */
  loadLogs() {
    if (fs.existsSync(this.logsPath)) {
      try {
        const data = fs.readFileSync(this.logsPath, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error loading webhook logs:', error);
        return [];
      }
    }
    return [];
  }

  /**
   * Load delivery queue from disk (queue durability)
   * Rehydrates in-flight deliveries that survived a process restart
   */
  loadQueue() {
    if (fs.existsSync(this.queuePath)) {
      try {
        const data = fs.readFileSync(this.queuePath, 'utf8');
        const queue = JSON.parse(data);
        if (Array.isArray(queue) && queue.length > 0) {
          console.log(`Rehydrating ${queue.length} pending deliveries from queue`);
        }
        return queue;
      } catch (error) {
        console.error('Error loading delivery queue:', error);
        return [];
      }
    }
    return [];
  }

  /**
   * Save delivery queue to disk (checkpointing)
   * Persists pending deliveries so they survive process restarts
   */
  saveQueue() {
    try {
      fs.writeFileSync(this.queuePath, JSON.stringify(this.deliveryQueue, null, 2));
    } catch (error) {
      console.error('Error saving delivery queue:', error);
    }
  }

  /**
   * Save webhooks to storage
   */
  saveState() {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.webhooks, null, 2));
    } catch (error) {
      console.error('Error saving webhooks state:', error);
    }
  }

  /**
   * Save logs to storage (with rotation)
   */
  saveLogs() {
    try {
      // Keep only most recent entries
      if (this.logs.length > this.config.maxLogEntries) {
        this.logs = this.logs.slice(-this.config.maxLogEntries);
      }
      fs.writeFileSync(this.logsPath, JSON.stringify(this.logs, null, 2));
    } catch (error) {
      console.error('Error saving webhook logs:', error);
    }
  }

  /**
   * Register a webhook
   * 
   * @param {string} webhookUrl - URL to send events to
   * @param {array} eventTypes - Array of event types to listen for
   * @param {object} options - Additional options
   * @returns {object} Webhook registration with secret
   */
  register(webhookUrl, eventTypes = [], options = {}) {
    // Validate URL
    if (!this.isValidUrl(webhookUrl)) {
      throw new Error('Invalid webhook URL');
    }

    // Validate event types
    const validEventTypes = [
      'escrow_created',
      'escrow_funded',
      'escrow_locked',
      'escrow_released',
      'escrow_refunded',
      'escrow_disputed',
      'tipping_received',
      'payment_settled'
    ];

    const filtered = eventTypes.filter(e => validEventTypes.includes(e));
    if (filtered.length === 0) {
      throw new Error('No valid event types provided');
    }

    const webhookId = 'wh_' + crypto.randomBytes(16).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');

    const webhook = {
      id: webhookId,
      url: webhookUrl,
      eventTypes: filtered,
      secret,
      enabled: true,
      createdAt: Date.now(),
      lastTriggeredAt: null,
      successCount: 0,
      failureCount: 0,
      retryCount: 0,
      metadata: {
        description: options.description || null,
        headers: options.headers || {},
        active: true
      }
    };

    this.webhooks[webhookId] = webhook;
    this.saveState();

    // Log registration
    this.logEvent('webhook_registered', {
      webhookId,
      url: webhookUrl,
      eventTypes: filtered
    });

    return {
      webhookId,
      secret,
      url: webhookUrl,
      eventTypes: filtered,
      createdAt: webhook.createdAt
    };
  }

  /**
   * Update webhook registration
   */
  update(webhookId, updates = {}) {
    const webhook = this.webhooks[webhookId];
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    if (updates.eventTypes) {
      const validEventTypes = [
        'escrow_created', 'escrow_funded', 'escrow_locked', 'escrow_released',
        'escrow_refunded', 'escrow_disputed', 'tipping_received', 'payment_settled'
      ];
      updates.eventTypes = updates.eventTypes.filter(e => validEventTypes.includes(e));
    }

    Object.assign(webhook, updates);
    this.saveState();

    this.logEvent('webhook_updated', { webhookId, updates });

    return webhook;
  }

  /**
   * Unregister a webhook
   */
  unregister(webhookId) {
    const webhook = this.webhooks[webhookId];
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    delete this.webhooks[webhookId];
    this.saveState();

    this.logEvent('webhook_unregistered', { webhookId });

    return { success: true, webhookId };
  }

  /**
   * Get webhook by ID
   */
  get(webhookId) {
    return this.webhooks[webhookId] || null;
  }

  /**
   * List all webhooks or filtered
   */
  list(filters = {}) {
    let results = Object.values(this.webhooks);

    if (filters.eventType) {
      results = results.filter(w => w.eventTypes.includes(filters.eventType));
    }

    if (filters.enabled !== undefined) {
      results = results.filter(w => w.enabled === filters.enabled);
    }

    return results.map(w => ({
      id: w.id,
      url: w.url,
      eventTypes: w.eventTypes,
      enabled: w.enabled,
      createdAt: w.createdAt,
      lastTriggeredAt: w.lastTriggeredAt,
      successCount: w.successCount,
      failureCount: w.failureCount
    }));
  }

  /**
   * Emit an event to listening webhooks
   */
  async emit(eventType, eventData, context = {}) {
    // Validate event type
    const validEvents = [
      'escrow_created', 'escrow_funded', 'escrow_locked', 'escrow_released',
      'escrow_refunded', 'escrow_disputed', 'tipping_received', 'payment_settled'
    ];

    if (!validEvents.includes(eventType)) {
      throw new Error(`Invalid event type: ${eventType}`);
    }

    const eventId = 'evt_' + crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();

    // Find all webhooks listening for this event type
    const matchingWebhooks = Object.values(this.webhooks)
      .filter(w => w.enabled && w.eventTypes.includes(eventType));

    if (matchingWebhooks.length === 0) {
      this.logEvent(eventType, { eventData, context, noListeners: true });
      return { eventId, eventType, delivered: [], failed: [] };
    }

    const event = {
      id: eventId,
      type: eventType,
      timestamp,
      data: eventData,
      context
    };

    // Queue deliveries
    const delivered = [];
    const failed = [];

    for (const webhook of matchingWebhooks) {
      const delivery = {
        webhookId: webhook.id,
        event,
        attempt: 1,
        nextRetryAt: null,
        status: 'pending'
      };

      this.deliveryQueue.push(delivery);

      // Log event
      this.logEvent(eventType, {
        eventId,
        webhookId: webhook.id,
        status: 'queued'
      });
    }

    // Checkpoint queue to disk after adding new deliveries
    // This ensures queue survives process restart
    if (matchingWebhooks.length > 0) {
      this.saveQueue();
    }

    // Return immediately (processing happens asynchronously)
    return {
      eventId,
      eventType,
      timestamp,
      webhooksNotified: matchingWebhooks.length
    };
  }

  /**
   * Start queue processor
   * Processes delivery queue at regular intervals
   * Can be mocked in tests for deterministic behavior
   */
  startQueueProcessor() {
    if (this.queueProcessorHandle) {
      clearInterval(this.queueProcessorHandle);
    }
    
    this.queueProcessorHandle = setInterval(() => {
      this.processDeliveryQueue();
    }, 1000); // Check queue every 1 second
  }

  /**
   * Start queue checkpointing
   * Periodically saves queue to disk for durability
   */
  startQueueCheckpointing() {
    if (this.checkpointHandle) {
      clearInterval(this.checkpointHandle);
    }

    this.checkpointHandle = setInterval(() => {
      if (this.deliveryQueue.length > 0) {
        this.saveQueue();
      }
    }, this.config.queueCheckpointIntervalMs);
  }

  /**
   * Process delivery queue
   * Handles retries with exponential backoff
   * Persists queue state after processing
   */
  async processDeliveryQueue() {
    if (this.processingQueue || this.deliveryQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    this.queueProcessingPromise = (async () => {
      try {
        // Process deliveries that are ready to be sent
        const now = Date.now();
        const toProcess = [];
        const remaining = [];

        for (const delivery of this.deliveryQueue) {
          if (!delivery.nextRetryAt || delivery.nextRetryAt <= now) {
            toProcess.push(delivery);
          } else {
            remaining.push(delivery);
          }
        }

        this.deliveryQueue = remaining;

        // Process in parallel (with concurrency limit)
        const concurrency = 5;
        for (let i = 0; i < toProcess.length; i += concurrency) {
          const batch = toProcess.slice(i, i + concurrency);
          await Promise.all(batch.map(d => this.deliverWebhook(d)));
        }

        // Checkpoint queue after processing batch
        this.saveQueue();

        // Emit completion event for test harnesses (via EventEmitter)
        super.emit('queueProcessingComplete');
      } finally {
        this.processingQueue = false;
      }
    })();

    return this.queueProcessingPromise;
  }

  /**
   * Wait for queue to finish processing all pending deliveries
   * Useful for tests that need to verify delivery completion
   */
  async waitForQueueCompletion(timeoutMs = 10000) {
    const start = Date.now();
    while (this.processingQueue || this.deliveryQueue.length > 0) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Queue processing timeout after ${timeoutMs}ms`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Stop queue processor (for cleanup)
   */
  stopQueueProcessor() {
    if (this.queueProcessorHandle) {
      clearInterval(this.queueProcessorHandle);
      this.queueProcessorHandle = null;
    }
    if (this.checkpointHandle) {
      clearInterval(this.checkpointHandle);
      this.checkpointHandle = null;
    }
  }

  /**
   * Deliver a webhook with retry logic
   * Handles both successful delivery and failures with exponential backoff
   */
  async deliverWebhook(delivery) {
    const { webhookId, event, attempt } = delivery;
    const webhook = this.webhooks[webhookId];

    if (!webhook) {
      this.logEvent('webhook_delivery_skipped', {
        webhookId,
        eventId: event.id,
        reason: 'webhook_not_found'
      });
      return;
    }

    try {
      // Create signature
      const signature = this.createSignature(event, webhook.secret);

      // Send webhook
      await this.sendRequest(webhook.url, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-ID': webhook.id,
          'X-Event-ID': event.id,
          'X-Event-Type': event.type,
          'X-Timestamp': event.timestamp.toString(),
          'X-Signature': signature,
          ...(webhook.metadata.headers || {})
        },
        body: JSON.stringify(event)
      });

      // Success - delivery complete, item removed from queue (implicitly by not re-queuing)
      webhook.lastTriggeredAt = Date.now();
      webhook.successCount++;
      this.saveState();

      this.logEvent('webhook_delivered', {
        webhookId,
        eventId: event.id,
        eventType: event.type,
        attempt,
        statusCode: 200
      });

      // Emit event for test synchronization (via EventEmitter, not webhook event)
      super.emit('webhookDelivered', { webhookId, eventId: event.id });

    } catch (error) {
      // Check if we should retry
      if (attempt < this.config.maxRetries) {
        // Calculate next retry with exponential backoff
        const delayMs = Math.min(
          this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt - 1),
          this.config.maxDelayMs
        );

        const nextRetryAt = Date.now() + delayMs;

        // Re-queue with updated attempt
        const delivery2 = {
          ...delivery,
          attempt: attempt + 1,
          nextRetryAt,
          status: 'retry_scheduled'
        };

        // Add back to queue and checkpoint
        this.deliveryQueue.push(delivery2);
        this.saveQueue();

        webhook.failureCount++;
        webhook.retryCount++;
        this.saveState();

        this.logEvent('webhook_delivery_failed_retry', {
          webhookId,
          eventId: event.id,
          eventType: event.type,
          attempt,
          error: error.message,
          nextRetryAt,
          delayMs
        });

      } else {
        // Max retries exceeded - delivery dropped
        webhook.failureCount++;
        this.saveState();

        this.logEvent('webhook_delivery_failed_max_retries', {
          webhookId,
          eventId: event.id,
          eventType: event.type,
          attempt,
          error: error.message
        });

        // Emit event for test synchronization (via EventEmitter, not webhook event)
        super.emit('webhookDeliveryFailed', { webhookId, eventId: event.id });
      }
    }
  }

  /**
   * Send HTTP request
   */
  sendRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: options.headers || {},
        timeout: this.config.requestTimeoutMs
      };

      const req = client.request(requestOptions, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: data });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * Create HMAC signature for webhook verification
   */
  createSignature(event, secret) {
    const message = JSON.stringify(event);
    return crypto
      .createHmac('sha256', secret)
      .update(message)
      .digest('hex');
  }

  /**
   * Verify webhook signature
   */
  verifySignature(webhookId, event, signature) {
    const webhook = this.webhooks[webhookId];
    if (!webhook) {
      return false;
    }

    const expectedSignature = this.createSignature(event, webhook.secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Get webhook history
   */
  getHistory(webhookId = null, limit = 100) {
    let results = this.logs;

    if (webhookId) {
      results = results.filter(l => l.data && l.data.webhookId === webhookId);
    }

    return results.slice(-limit);
  }

  /**
   * Log an event
   */
  logEvent(type, data) {
    const logEntry = {
      timestamp: Date.now(),
      type,
      data
    };

    this.logs.push(logEntry);
    this.saveLogs();

    // Emit for real-time monitoring
    super.emit(type, logEntry);
  }

  /**
   * Get webhook statistics
   */
  getStats(webhookId = null) {
    let webhooks = Object.values(this.webhooks);

    if (webhookId) {
      webhooks = webhooks.filter(w => w.id === webhookId);
    }

    const stats = {
      total: webhooks.length,
      enabled: webhooks.filter(w => w.enabled).length,
      disabled: webhooks.filter(w => !w.enabled).length,
      totalSuccess: 0,
      totalFailures: 0,
      totalRetries: 0,
      webhooks: []
    };

    for (const w of webhooks) {
      stats.totalSuccess += w.successCount || 0;
      stats.totalFailures += w.failureCount || 0;
      stats.totalRetries += w.retryCount || 0;

      stats.webhooks.push({
        id: w.id,
        url: w.url,
        enabled: w.enabled,
        eventTypes: w.eventTypes,
        successCount: w.successCount,
        failureCount: w.failureCount,
        retryCount: w.retryCount,
        successRate: w.successCount + w.failureCount > 0
          ? (w.successCount / (w.successCount + w.failureCount) * 100).toFixed(2) + '%'
          : 'N/A',
        lastTriggeredAt: w.lastTriggeredAt,
        createdAt: w.createdAt
      });
    }

    return stats;
  }

  /**
   * Validate webhook URL
   */
  isValidUrl(urlString) {
    try {
      const url = new URL(urlString);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Clear old logs (maintenance)
   */
  clearOldLogs(daysOld = 30) {
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const beforeCount = this.logs.length;
    this.logs = this.logs.filter(l => l.timestamp > cutoffTime);
    const removed = beforeCount - this.logs.length;
    this.saveLogs();
    return { removed, remaining: this.logs.length };
  }

  /**
   * Test webhook delivery
   */
  async testWebhook(webhookId) {
    const webhook = this.webhooks[webhookId];
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    const testEvent = {
      id: 'test_' + crypto.randomBytes(8).toString('hex'),
      type: 'test',
      timestamp: Date.now(),
      data: {
        message: 'This is a test webhook delivery'
      },
      context: {
        test: true
      }
    };

    const signature = this.createSignature(testEvent, webhook.secret);

    try {
      const response = await this.sendRequest(webhook.url, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-ID': webhook.id,
          'X-Event-ID': testEvent.id,
          'X-Event-Type': 'test',
          'X-Timestamp': testEvent.timestamp.toString(),
          'X-Signature': signature,
          ...(webhook.metadata.headers || {})
        },
        body: JSON.stringify(testEvent)
      });

      this.logEvent('webhook_test', {
        webhookId,
        success: true,
        statusCode: response.statusCode
      });

      return {
        success: true,
        statusCode: response.statusCode,
        message: 'Webhook test delivered successfully'
      };
    } catch (error) {
      this.logEvent('webhook_test', {
        webhookId,
        success: false,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        message: 'Webhook test failed: ' + error.message
      };
    }
  }

  /**
   * Cleanup and shutdown
   * - Stops queue processor
   * - Saves final queue state
   * - Cleans up timers
   */
  async shutdown() {
    this.stopQueueProcessor();
    
    // Wait for any in-flight processing to complete
    if (this.queueProcessingPromise) {
      await this.queueProcessingPromise;
    }

    // Final checkpoint of queue
    this.saveQueue();
    
    // Remove all listeners for cleanup
    this.removeAllListeners();
  }
}

module.exports = { WebhookManager };
