/**
 * GitHub Tipping Webhook Endpoint
 * 
 * Express middleware for handling GitHub tipping requests
 * 
 * Endpoint: POST /a2a/github-tip
 * 
 * Request Body:
 * {
 *   "githubRepo": "owner/repo",
 *   "tipper": "agent-id or 0x...",
 *   "recipient": "github-username or 0x...",
 *   "amount": 100,
 *   "token": "SHIB|USDC",
 *   "message": "Optional message",
 *   "issueUrl": "https://github.com/.../issues/123",
 *   "commitRef": "abc123...",
 *   "autoEscrow": true  // Create and fund escrow automatically
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "tip": { ... },
 *   "escrow": { ... } (if autoEscrow enabled)
 * }
 */

const express = require('express');

/**
 * Create GitHub tipping webhook router
 * 
 * @param {GitHubTippingSystem} tippingSystem - Initialized tipping system
 * @param {EscrowSystem} escrowSystem - Initialized escrow system
 * @param {function} paymentHandler - Optional handler for actual payment processing
 * @returns {express.Router} - Express router for webhook
 */
function createGitHubTippingWebhook(tippingSystem, escrowSystem, paymentHandler = null) {
  const router = express.Router();

  /**
   * POST /a2a/github-tip
   * Create a GitHub tip with optional escrow integration
   */
  router.post('/a2a/github-tip', express.json(), async (req, res) => {
    try {
      const {
        githubRepo,
        tipper,
        recipient,
        amount,
        token = 'SHIB',
        message = null,
        issueUrl = null,
        commitRef = null,
        autoEscrow = false,
        autoFund = false
      } = req.body;

      // Validate required fields
      if (!githubRepo || !tipper || !recipient || !amount) {
        return res.status(400).json({
          error: 'Missing required fields: githubRepo, tipper, recipient, amount'
        });
      }

      // Create tip
      const tip = tippingSystem.createTip({
        githubRepo,
        tipper,
        recipient,
        amount,
        token,
        message,
        issueUrl,
        commitRef
      });

      const response = {
        success: true,
        tip
      };

      // Auto-create escrow if requested
      if (autoEscrow || autoFund) {
        try {
          const escrowCreator = (tipData) => {
            const escrow = escrowSystem.create({
              payer: tipData.tipper,
              payee: tipData.recipient,
              amount: tipData.amount,
              purpose: `GitHub tip for ${tipData.github.repo}`,
              token: tipData.token,
              conditions: {
                requiresApproval: token === 'USDC',
                requiresDelivery: false,
                customConditions: [
                  {
                    type: 'github-tip',
                    repo: tipData.github.repo,
                    issueUrl: tipData.github.issueUrl,
                    commitRef: tipData.github.commitRef
                  }
                ]
              },
              timeoutMinutes: 1440 // 24 hour timeout
            });
            return escrow.id;
          };

          const escrowResult = tippingSystem.createEscrow(tip.id, escrowCreator);
          response.escrow = escrowResult;

          // Auto-fund if payment handler provided
          if (autoFund && paymentHandler) {
            try {
              const paymentResult = await paymentHandler({
                type: 'github-tip',
                tipId: tip.id,
                escrowId: escrowResult.escrowId,
                tip: escrowResult.tip,
                recipient: tip.recipient,
                amount: tip.amount,
                token: tip.token
              });

              // Update tip with transaction hash
              if (paymentResult && paymentResult.txHash) {
                tippingSystem.fundEscrow(tip.id, paymentResult.txHash);
                response.payment = paymentResult;
              }
            } catch (paymentErr) {
              // Log but don't fail - escrow is created but not funded
              console.error('Payment processing error:', paymentErr.message);
              response.paymentError = paymentErr.message;
            }
          }
        } catch (escrowErr) {
          response.escrowError = escrowErr.message;
        }
      }

      res.status(201).json(response);

    } catch (error) {
      console.error('GitHub tipping error:', error);
      res.status(400).json({
        error: error.message
      });
    }
  });

  /**
   * POST /a2a/github-tip/:tipId/fund
   * Fund an existing tip escrow
   */
  router.post('/a2a/github-tip/:tipId/fund', express.json(), async (req, res) => {
    try {
      const { tipId } = req.params;
      const { txHash } = req.body;

      if (!txHash) {
        return res.status(400).json({ error: 'Missing txHash' });
      }

      const tip = tippingSystem.getTip(tipId);
      if (!tip) {
        return res.status(404).json({ error: 'Tip not found' });
      }

      const updated = tippingSystem.fundEscrow(tipId, txHash);

      res.json({
        success: true,
        tip: updated
      });

    } catch (error) {
      console.error('Fund error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /a2a/github-tip/:tipId/lock
   * Lock a funded escrow
   */
  router.post('/a2a/github-tip/:tipId/lock', express.json(), async (req, res) => {
    try {
      const { tipId } = req.params;

      const tip = tippingSystem.getTip(tipId);
      if (!tip) {
        return res.status(404).json({ error: 'Tip not found' });
      }

      const updated = tippingSystem.lockEscrow(tipId);

      res.json({
        success: true,
        tip: updated
      });

    } catch (error) {
      console.error('Lock error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /a2a/github-tip/:tipId/release
   * Release funds to recipient
   */
  router.post('/a2a/github-tip/:tipId/release', express.json(), async (req, res) => {
    try {
      const { tipId } = req.params;
      const { txHash, blockNumber, gasUsed } = req.body;

      if (!txHash) {
        return res.status(400).json({ error: 'Missing txHash' });
      }

      const tip = tippingSystem.getTip(tipId);
      if (!tip) {
        return res.status(404).json({ error: 'Tip not found' });
      }

      const updated = tippingSystem.releaseTip(tipId, txHash, blockNumber, gasUsed);

      res.json({
        success: true,
        tip: updated
      });

    } catch (error) {
      console.error('Release error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /a2a/github-tip/:tipId/cancel
   * Cancel a tip
   */
  router.post('/a2a/github-tip/:tipId/cancel', express.json(), async (req, res) => {
    try {
      const { tipId } = req.params;
      const { reason } = req.body;

      const tip = tippingSystem.getTip(tipId);
      if (!tip) {
        return res.status(404).json({ error: 'Tip not found' });
      }

      const updated = tippingSystem.cancelTip(tipId, reason);

      res.json({
        success: true,
        tip: updated
      });

    } catch (error) {
      console.error('Cancel error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /a2a/github-tip/:tipId
   * Get tip details
   */
  router.get('/a2a/github-tip/:tipId', (req, res) => {
    try {
      const { tipId } = req.params;

      const tip = tippingSystem.getTip(tipId);
      if (!tip) {
        return res.status(404).json({ error: 'Tip not found' });
      }

      res.json({
        success: true,
        tip
      });

    } catch (error) {
      console.error('Get tip error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /a2a/github-tips
   * List tips with optional filters
   * Query params: githubRepo, tipper, recipient, state, token, minAmount, limit
   */
  router.get('/a2a/github-tips', (req, res) => {
    try {
      const {
        githubRepo,
        owner,
        tipper,
        recipient,
        state,
        token,
        minAmount,
        limit = 100
      } = req.query;

      const filters = {};
      if (githubRepo) filters.githubRepo = githubRepo;
      if (owner) filters.owner = owner;
      if (tipper) filters.tipper = tipper;
      if (recipient) filters.recipient = recipient;
      if (state) filters.state = state;
      if (token) filters.token = token;
      if (minAmount) filters.minAmount = parseFloat(minAmount);

      const tips = tippingSystem.listTips(filters).slice(0, parseInt(limit));

      res.json({
        success: true,
        count: tips.length,
        tips
      });

    } catch (error) {
      console.error('List tips error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /a2a/github-tips/repo/:owner/:repo
   * Get stats for specific repository
   */
  router.get('/a2a/github-tips/repo/:owner/:repo', (req, res) => {
    try {
      const { owner, repo } = req.params;
      const githubRepo = `${owner}/${repo}`;

      const stats = tippingSystem.getRepoStats(githubRepo);
      const tips = tippingSystem.listTips({ githubRepo }).slice(0, 20);

      res.json({
        success: true,
        stats,
        recentTips: tips
      });

    } catch (error) {
      console.error('Repo stats error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /a2a/github-tips/tipper/:tipper
   * Get tipper statistics
   */
  router.get('/a2a/github-tips/tipper/:tipper', (req, res) => {
    try {
      const { tipper } = req.params;

      const stats = tippingSystem.getTipperStats(tipper);
      const tips = tippingSystem.listTips({ tipper }).slice(0, 20);

      res.json({
        success: true,
        stats,
        recentTips: tips
      });

    } catch (error) {
      console.error('Tipper stats error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /a2a/github-tips/stats
   * Get global tipping statistics
   */
  router.get('/a2a/github-tips/stats', (req, res) => {
    try {
      const stats = tippingSystem.getGlobalStats();

      res.json({
        success: true,
        stats
      });

    } catch (error) {
      console.error('Global stats error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /a2a/github-tips/batch-process
   * Process batch of tips (for nightly settlements)
   */
  router.post('/a2a/github-tips/batch-process', express.json(), (req, res) => {
    try {
      const { filters = {} } = req.body;

      const batch = tippingSystem.processBatch(filters);

      res.json({
        success: true,
        batch
      });

    } catch (error) {
      console.error('Batch process error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = { createGitHubTippingWebhook };
