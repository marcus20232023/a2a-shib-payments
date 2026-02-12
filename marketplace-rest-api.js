#!/usr/bin/env node

/**
 * Marketplace REST API
 * 
 * Provides HTTP REST endpoints for the a2a-marketplace-ui frontend
 * Bridges marketplace adapter with React frontend via REST API
 * 
 * Endpoints:
 * - GET /agents - List all agents/service providers
 * - GET /agents/:id - Get agent profile
 * - GET /agents/:id/services - Get agent's services  
 * - GET /services - List all services with filters
 * - GET /services/:id - Get service details
 * - POST /services - Create new service (provider)
 * - GET /tasks - List tasks/purchase orders
 * - POST /tasks - Create new task
 * - PATCH /tasks/:id - Update task status
 * - GET /tasks/:id/escrow - Get escrow status
 * - POST /tasks/:id/escrow/fund - Fund escrow
 * - POST /tasks/:id/escrow/release - Release escrow
 * - GET /tasks/:id/negotiations - Get negotiations for task
 * - POST /tasks/:id/negotiations - Create negotiation
 * - POST /tasks/:id/negotiations/:negotiationId/offers - Submit offer
 * - GET /dashboard/stats - Get dashboard statistics
 * - POST /api/ws/token - Get WebSocket token
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { EscrowSystem } = require('./escrow.js');
const { PaymentNegotiationSystem } = require('./payment-negotiation.js');
const { MarketplaceAdapter, ServiceDefinition } = require('./marketplace-adapter.js');
const { ReputationSystem } = require('./reputation.js');

const PORT = process.env.MARKETPLACE_API_PORT || 8003;
const JWT_SECRET = process.env.JWT_SECRET || 'a2a-marketplace-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'a2a-marketplace-refresh-secret-key-change-in-production';
const JWT_EXPIRY = '1h';
const JWT_REFRESH_EXPIRY = '7d';

// Auth users storage path
const AUTH_USERS_PATH = './auth-users.json';

// Load or initialize auth users database
function loadAuthUsers() {
  if (fs.existsSync(AUTH_USERS_PATH)) {
    return JSON.parse(fs.readFileSync(AUTH_USERS_PATH, 'utf8'));
  }
  return {};
}

function saveAuthUsers(users) {
  fs.writeFileSync(AUTH_USERS_PATH, JSON.stringify(users, null, 2));
}

let authUsers = loadAuthUsers();

// Hash password with bcrypt (salt rounds: 10 - good balance of security/speed)
const BCRYPT_SALT_ROUNDS = 10;

function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
}

// Verify password with bcrypt
function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

// Generate JWT token
function generateAccessToken(userId, walletAddress, email, isAgent) {
  return jwt.sign(
    { userId, walletAddress, email, isAgent },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

// Generate refresh token
function generateRefreshToken(userId, walletAddress) {
  return jwt.sign(
    { userId, walletAddress },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRY }
  );
}

// Verify JWT token
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Verify refresh token
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
}

// Initialize systems
const escrowSystem = new EscrowSystem('./marketplace-escrow.json');
const paymentNegotiationSystem = new PaymentNegotiationSystem(escrowSystem, './marketplace-negotiations.json');
const marketplace = new MarketplaceAdapter({
  escrowSystem,
  paymentNegotiationSystem,
  storePath: './marketplace-state.json'
});
const reputationSystem = new ReputationSystem('./marketplace-reputation.json');

// Mock agent database (in real system, would come from blockchain/database)
const agentsDB = {
  'agent-001': {
    id: 'agent-001',
    name: 'Alice Data Scientist',
    bio: 'Expert in ML and data analysis with 5+ years experience',
    specialization: 'data-analysis',
    walletAddress: '0x1234567890abcdef',
    rating: 4.8,
    reviewCount: 45,
    profileImage: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice',
    isVerified: true,
    totalEarnings: 15000,
    completedTasks: 78,
    createdAt: '2023-01-15T10:00:00Z',
    updatedAt: '2024-02-12T10:00:00Z'
  },
  'agent-002': {
    id: 'agent-002',
    name: 'Bob AI Developer',
    bio: 'Full-stack AI/ML engineer, specialized in LLMs',
    specialization: 'ai-development',
    walletAddress: '0xfedcba0987654321',
    rating: 4.9,
    reviewCount: 67,
    profileImage: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Bob',
    isVerified: true,
    totalEarnings: 25000,
    completedTasks: 92,
    createdAt: '2023-03-20T10:00:00Z',
    updatedAt: '2024-02-11T10:00:00Z'
  },
  'agent-003': {
    id: 'agent-003',
    name: 'Charlie Content Writer',
    bio: 'Professional technical content writer',
    specialization: 'content-writing',
    walletAddress: '0xabcdef1234567890',
    rating: 4.6,
    reviewCount: 34,
    profileImage: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie',
    isVerified: false,
    totalEarnings: 8500,
    completedTasks: 42,
    createdAt: '2023-06-10T10:00:00Z',
    updatedAt: '2024-02-10T10:00:00Z'
  }
};

// Mock services database
const servicesDB = {
  'svc-001': {
    id: 'svc-001',
    agentId: 'agent-001',
    title: 'Data Analysis Report',
    description: 'Comprehensive analysis of your dataset with visualizations',
    price: 500,
    currency: 'SHIB',
    estimatedCompletionTime: '3 days',
    tags: ['analysis', 'data', 'reports'],
    status: 'active',
    createdAt: '2024-01-01T10:00:00Z',
    updatedAt: '2024-02-10T10:00:00Z'
  },
  'svc-002': {
    id: 'svc-002',
    agentId: 'agent-002',
    title: 'LLM Fine-tuning',
    description: 'Fine-tune a language model for your specific use case',
    price: 2000,
    currency: 'SHIB',
    estimatedCompletionTime: '1 week',
    tags: ['ai', 'ml', 'llm'],
    status: 'active',
    createdAt: '2024-01-05T10:00:00Z',
    updatedAt: '2024-02-12T10:00:00Z'
  },
  'svc-003': {
    id: 'svc-003',
    agentId: 'agent-003',
    title: 'Blog Post Writing',
    description: '2000-word SEO-optimized blog post on any topic',
    price: 200,
    currency: 'USDC',
    estimatedCompletionTime: '2 days',
    tags: ['writing', 'content', 'seo'],
    status: 'active',
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-02-08T10:00:00Z'
  }
};

// Mock tasks/purchase orders
const tasksDB = {
  'task-001': {
    id: 'task-001',
    serviceId: 'svc-001',
    buyerId: 'buyer-001',
    agentId: 'agent-001',
    title: 'Analyze Q4 Sales Data',
    description: 'Analyze our Q4 sales data and provide insights',
    status: 'in_progress',
    price: 500,
    currency: 'SHIB',
    escrowStatus: 'held',
    negotiation: null,
    createdAt: '2024-02-05T10:00:00Z',
    updatedAt: '2024-02-12T10:00:00Z'
  },
  'task-002': {
    id: 'task-002',
    serviceId: 'svc-002',
    buyerId: 'buyer-002',
    agentId: 'agent-002',
    title: 'Fine-tune GPT for Customer Support',
    description: 'Customize a model for customer support chatbot',
    status: 'pending',
    price: 2000,
    currency: 'SHIB',
    escrowStatus: 'not_funded',
    negotiation: null,
    createdAt: '2024-02-10T10:00:00Z',
    updatedAt: '2024-02-11T10:00:00Z'
  }
};

// Initialize with mock services in marketplace
Object.values(servicesDB).forEach(service => {
  if (!marketplace.getService(service.id)) {
    marketplace.registerService({
      id: service.id,
      providerId: service.agentId,
      name: service.title,
      description: service.description,
      category: service.tags[0] || 'general',
      basePrice: service.price,
      token: service.currency,
      estimatedCompletionTime: service.estimatedCompletionTime,
      tags: service.tags
    });
  }
});

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ============================================================
// AGENTS ENDPOINTS
// ============================================================

/**
 * GET /agents - List all agents with pagination and filtering
 * Query params: page, limit, specialization, minRating, sortBy
 */
app.get('/agents', (req, res) => {
  try {
    const { page = 1, limit = 12, specialization, minRating, sortBy = 'rating' } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    let agents = Object.values(agentsDB);

    // Apply filters
    if (specialization) {
      agents = agents.filter(a => a.specialization === specialization);
    }
    if (minRating) {
      agents = agents.filter(a => a.rating >= parseFloat(minRating));
    }

    // Apply sorting
    switch (sortBy) {
      case 'rating':
        agents.sort((a, b) => b.rating - a.rating);
        break;
      case 'newest':
        agents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'popular':
        agents.sort((a, b) => b.reviewCount - a.reviewCount);
        break;
      case 'earnings':
        agents.sort((a, b) => b.totalEarnings - a.totalEarnings);
        break;
    }

    // Pagination
    const total = agents.length;
    const start = (pageNum - 1) * limitNum;
    const paginatedAgents = agents.slice(start, start + limitNum);

    return res.json({
      success: true,
      data: paginatedAgents,
      page: pageNum,
      limit: limitNum,
      total: total,
      hasMore: start + limitNum < total
    });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /agents/:id - Get agent profile with services and stats
 */
app.get('/agents/:id', (req, res) => {
  try {
    const agent = agentsDB[req.params.id];
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    // Get agent's services
    const services = Object.values(servicesDB).filter(s => s.agentId === req.params.id);
    
    // Get agent's reputation profile
    const reputation = reputationSystem.getScore(req.params.id);
    const profile = reputationSystem.getProfile(req.params.id);
    const reviews = profile?.ratings || [];

    const agentProfile = {
      ...agent,
      services: services,
      reviews: reviews,
      stats: {
        successRate: 98,
        avgCompletionTime: 3,
        responseTime: 1,
        trustLevel: reputation.trustLevel || 'verified',
        avgRating: reputation.average || agent.rating
      }
    };

    return res.json({
      success: true,
      data: agentProfile
    });
  } catch (error) {
    console.error('Error fetching agent:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /agents/:id/services - Get agent's services
 */
app.get('/agents/:id/services', (req, res) => {
  try {
    const services = Object.values(servicesDB).filter(s => s.agentId === req.params.id);
    
    return res.json({
      success: true,
      data: services
    });
  } catch (error) {
    console.error('Error fetching agent services:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// SERVICES ENDPOINTS
// ============================================================

/**
 * GET /services - List all services with filtering and pagination
 */
app.get('/services', (req, res) => {
  try {
    const { page = 1, limit = 12, category, minPrice, maxPrice, sortBy = 'newest' } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    let services = Object.values(servicesDB);

    // Apply filters
    if (category) {
      services = services.filter(s => s.tags.includes(category));
    }
    if (minPrice) {
      services = services.filter(s => s.price >= parseFloat(minPrice));
    }
    if (maxPrice) {
      services = services.filter(s => s.price <= parseFloat(maxPrice));
    }

    // Apply sorting
    switch (sortBy) {
      case 'newest':
        services.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'price-low':
        services.sort((a, b) => a.price - b.price);
        break;
      case 'price-high':
        services.sort((a, b) => b.price - a.price);
        break;
    }

    // Pagination
    const total = services.length;
    const start = (pageNum - 1) * limitNum;
    const paginatedServices = services.slice(start, start + limitNum);

    return res.json({
      success: true,
      data: paginatedServices,
      page: pageNum,
      limit: limitNum,
      total: total,
      hasMore: start + limitNum < total
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /services/:id - Get service details
 */
app.get('/services/:id', (req, res) => {
  try {
    const service = servicesDB[req.params.id];
    if (!service) {
      return res.status(404).json({
        success: false,
        error: 'Service not found'
      });
    }

    const agent = agentsDB[service.agentId];
    
    const serviceDetail = {
      ...service,
      agent: {
        id: agent.id,
        name: agent.name,
        rating: agent.rating,
        isVerified: agent.isVerified
      },
      completedCount: 10,
      escrowTerms: 'Full refund if not satisfied within 7 days',
      requirements: ['Detailed requirements document', 'Access to dataset']
    };

    return res.json({
      success: true,
      data: serviceDetail
    });
  } catch (error) {
    console.error('Error fetching service:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /services - Create new service (provider only)
 */
app.post('/services', (req, res) => {
  try {
    const { agentId, title, description, price, currency, estimatedCompletionTime, tags } = req.body;

    if (!agentId || !title || !price) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: agentId, title, price'
      });
    }

    const serviceId = 'svc-' + crypto.randomBytes(8).toString('hex').substring(0, 12);
    const newService = {
      id: serviceId,
      agentId,
      title,
      description,
      price,
      currency: currency || 'SHIB',
      estimatedCompletionTime: estimatedCompletionTime || 'TBD',
      tags: tags || [],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    servicesDB[serviceId] = newService;

    // Also register in marketplace
    marketplace.registerService({
      id: serviceId,
      providerId: agentId,
      name: title,
      description,
      category: tags?.[0] || 'general',
      basePrice: price,
      token: currency || 'SHIB'
    });

    return res.status(201).json({
      success: true,
      data: newService
    });
  } catch (error) {
    console.error('Error creating service:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// TASKS ENDPOINTS
// ============================================================

/**
 * GET /tasks - List tasks with pagination and filtering
 */
app.get('/tasks', (req, res) => {
  try {
    const { page = 1, limit = 10, status, agentId, buyerId } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    let tasks = Object.values(tasksDB);

    // Apply filters
    if (status) {
      tasks = tasks.filter(t => t.status === status);
    }
    if (agentId) {
      tasks = tasks.filter(t => t.agentId === agentId);
    }
    if (buyerId) {
      tasks = tasks.filter(t => t.buyerId === buyerId);
    }

    // Sort by creation date (newest first)
    tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const total = tasks.length;
    const start = (pageNum - 1) * limitNum;
    const paginatedTasks = tasks.slice(start, start + limitNum);

    return res.json({
      success: true,
      data: paginatedTasks,
      page: pageNum,
      limit: limitNum,
      total: total,
      hasMore: start + limitNum < total
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /tasks/:id - Get task details
 */
app.get('/tasks/:id', (req, res) => {
  try {
    const task = tasksDB[req.params.id];
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    return res.json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /tasks - Create new task (purchase order)
 */
app.post('/tasks', (req, res) => {
  try {
    const { serviceId, buyerId, agentId } = req.body;

    if (!serviceId || !buyerId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: serviceId, buyerId'
      });
    }

    const service = servicesDB[serviceId];
    if (!service) {
      return res.status(404).json({
        success: false,
        error: 'Service not found'
      });
    }

    const taskId = 'task-' + crypto.randomBytes(8).toString('hex').substring(0, 12);
    const newTask = {
      id: taskId,
      serviceId,
      buyerId,
      agentId: agentId || service.agentId,
      title: service.title,
      description: service.description,
      status: 'pending',
      price: service.price,
      currency: service.currency,
      escrowStatus: 'not_funded',
      negotiation: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    tasksDB[taskId] = newTask;

    return res.status(201).json({
      success: true,
      data: newTask
    });
  } catch (error) {
    console.error('Error creating task:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PATCH /tasks/:id - Update task status
 */
app.patch('/tasks/:id', (req, res) => {
  try {
    const task = tasksDB[req.params.id];
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const { status, escrowStatus } = req.body;

    if (status) {
      task.status = status;
    }
    if (escrowStatus) {
      task.escrowStatus = escrowStatus;
    }

    task.updatedAt = new Date().toISOString();
    tasksDB[req.params.id] = task;

    return res.json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('Error updating task:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// ESCROW ENDPOINTS
// ============================================================

/**
 * GET /tasks/:taskId/escrow - Get escrow status for task
 */
app.get('/tasks/:taskId/escrow', (req, res) => {
  try {
    const task = tasksDB[req.params.taskId];
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const escrowStatus = {
      id: 'esc-' + req.params.taskId,
      taskId: req.params.taskId,
      status: task.escrowStatus,
      amount: task.price,
      currency: task.currency,
      fundedAt: task.escrowStatus !== 'not_funded' ? new Date(Date.now() - 86400000).toISOString() : null,
      releasedAt: task.escrowStatus === 'released' ? new Date().toISOString() : null,
      refundedAt: null,
      txHash: task.escrowStatus !== 'not_funded' ? '0x' + crypto.randomBytes(32).toString('hex') : null
    };

    return res.json({
      success: true,
      data: escrowStatus
    });
  } catch (error) {
    console.error('Error fetching escrow status:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /tasks/:taskId/escrow/fund - Fund escrow for task
 */
app.post('/tasks/:taskId/escrow/fund', (req, res) => {
  try {
    const task = tasksDB[req.params.taskId];
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const { txHash } = req.body;
    if (!txHash) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: txHash'
      });
    }

    // Update task escrow status
    task.escrowStatus = 'funded';
    task.updatedAt = new Date().toISOString();
    tasksDB[req.params.taskId] = task;

    return res.json({
      success: true,
      data: {
        id: 'esc-' + req.params.taskId,
        taskId: req.params.taskId,
        status: 'funded',
        amount: task.price,
        currency: task.currency,
        txHash: txHash,
        fundedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error funding escrow:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /tasks/:taskId/escrow/release - Release escrow funds
 */
app.post('/tasks/:taskId/escrow/release', (req, res) => {
  try {
    const task = tasksDB[req.params.taskId];
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    if (task.escrowStatus !== 'funded' && task.escrowStatus !== 'held') {
      return res.status(400).json({
        success: false,
        error: `Cannot release escrow in status: ${task.escrowStatus}`
      });
    }

    // Update task status
    task.status = 'completed';
    task.escrowStatus = 'released';
    task.updatedAt = new Date().toISOString();
    tasksDB[req.params.taskId] = task;

    return res.json({
      success: true,
      data: {
        id: 'esc-' + req.params.taskId,
        taskId: req.params.taskId,
        status: 'released',
        amount: task.price,
        currency: task.currency,
        releasedAt: new Date().toISOString(),
        txHash: '0x' + crypto.randomBytes(32).toString('hex')
      }
    });
  } catch (error) {
    console.error('Error releasing escrow:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// NEGOTIATIONS ENDPOINTS
// ============================================================

/**
 * GET /tasks/:taskId/negotiations - Get negotiations for task
 */
app.get('/tasks/:taskId/negotiations', (req, res) => {
  try {
    const task = tasksDB[req.params.taskId];
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Mock negotiation data
    const negotiations = [
      {
        id: 'neg-001',
        taskId: req.params.taskId,
        initiatorId: task.buyerId,
        currentPrice: task.price,
        proposedPrice: task.price * 0.9,
        message: 'Can you do it for 10% less?',
        status: 'pending',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        expiresAt: new Date(Date.now() + 432000000).toISOString(),
        offers: [
          {
            id: 'offer-001',
            negotiationId: 'neg-001',
            userId: task.buyerId,
            price: task.price * 0.9,
            message: 'Proposed lower price',
            timestamp: new Date(Date.now() - 86400000).toISOString(),
            status: 'pending'
          }
        ]
      }
    ];

    return res.json({
      success: true,
      data: negotiations
    });
  } catch (error) {
    console.error('Error fetching negotiations:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /tasks/:taskId/negotiations - Create negotiation for task
 */
app.post('/tasks/:taskId/negotiations', (req, res) => {
  try {
    const task = tasksDB[req.params.taskId];
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const { initiatorId, proposedPrice, message } = req.body;
    if (!initiatorId || proposedPrice === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: initiatorId, proposedPrice'
      });
    }

    const negotiationId = 'neg-' + crypto.randomBytes(8).toString('hex').substring(0, 12);
    const negotiation = {
      id: negotiationId,
      taskId: req.params.taskId,
      initiatorId,
      currentPrice: task.price,
      proposedPrice,
      message: message || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 432000000).toISOString(),
      offers: []
    };

    return res.status(201).json({
      success: true,
      data: negotiation
    });
  } catch (error) {
    console.error('Error creating negotiation:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /tasks/:taskId/negotiations/:negotiationId/offers - Submit offer in negotiation
 */
app.post('/tasks/:taskId/negotiations/:negotiationId/offers', (req, res) => {
  try {
    const { userId, price, message } = req.body;
    if (!userId || price === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, price'
      });
    }

    const offer = {
      id: 'offer-' + crypto.randomBytes(8).toString('hex').substring(0, 12),
      negotiationId: req.params.negotiationId,
      userId,
      price,
      message: message || '',
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    return res.status(201).json({
      success: true,
      data: offer
    });
  } catch (error) {
    console.error('Error creating offer:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// DASHBOARD ENDPOINTS
// ============================================================

/**
 * GET /dashboard/stats - Get dashboard statistics
 */
app.get('/dashboard/stats', (req, res) => {
  try {
    const { agentId } = req.query;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agentId query parameter required'
      });
    }

    const agent = agentsDB[agentId];
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    // Get agent's tasks
    const agentTasks = Object.values(tasksDB).filter(t => t.agentId === agentId);
    const completedTasks = agentTasks.filter(t => t.status === 'completed').length;
    const activeTasks = agentTasks.filter(t => t.status === 'in_progress').length;
    const totalEarnings = agentTasks
      .filter(t => t.status === 'completed')
      .reduce((sum, t) => sum + t.price, 0);

    const stats = {
      totalEarnings: totalEarnings || agent.totalEarnings,
      activeTasks,
      completedTasks: completedTasks || agent.completedTasks,
      successRate: 98,
      avgRating: agent.rating,
      pendingNegotiations: agentTasks.filter(t => t.negotiation).length
    };

    return res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// AUTHENTICATION ENDPOINTS
// ============================================================

/**
 * POST /auth/signup - Create new agent account
 */
app.post('/auth/signup', (req, res) => {
  try {
    const { walletAddress, password, confirmPassword, email, isAgent } = req.body;

    // Validation
    if (!walletAddress || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, password'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Check if user already exists
    const existingUser = Object.values(authUsers).find(u => u.walletAddress === walletAddress);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Account with this wallet address already exists'
      });
    }

    // Create new user
    const userId = `user-${Date.now()}`;
    const passwordHash = hashPassword(password);

    authUsers[userId] = {
      id: userId,
      walletAddress,
      email: email || null,
      passwordHash,
      isAgent: isAgent !== false, // Default to true
      createdAt: new Date().toISOString(),
      totalEarnings: 0,
      completedTasks: 0,
      rating: 0,
      reviewCount: 0,
      isVerified: false
    };

    saveAuthUsers(authUsers);

    // Generate tokens
    const accessToken = generateAccessToken(userId, walletAddress, email, isAgent !== false);
    const refreshToken = generateRefreshToken(userId, walletAddress);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        user: {
          id: userId,
          walletAddress,
          email: email || null,
          isAgent: isAgent !== false
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: 3600 // 1 hour in seconds
        }
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Signup failed'
    });
  }
});

/**
 * POST /auth/login - Login with wallet address and password
 */
app.post('/auth/login', (req, res) => {
  try {
    const { walletAddress, password } = req.body;

    // Validation
    if (!walletAddress || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, password'
      });
    }

    // Find user by wallet address
    const user = Object.values(authUsers).find(u => u.walletAddress === walletAddress);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid wallet address or password'
      });
    }

    // Verify password with bcrypt
    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid wallet address or password'
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.walletAddress, user.email, user.isAgent);
    const refreshToken = generateRefreshToken(user.id, user.walletAddress);

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          email: user.email,
          isAgent: user.isAgent,
          rating: user.rating,
          totalEarnings: user.totalEarnings,
          completedTasks: user.completedTasks
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: 3600 // 1 hour in seconds
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Login failed'
    });
  }
});

/**
 * POST /auth/refresh - Refresh access token
 */
app.post('/auth/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: refreshToken'
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token'
      });
    }

    // Find user
    const user = Object.values(authUsers).find(u => u.id === decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user.id, user.walletAddress, user.email, user.isAgent);

    return res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        expiresIn: 3600 // 1 hour in seconds
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Token refresh failed'
    });
  }
});

/**
 * POST /auth/logout - Logout (client should clear tokens)
 */
app.post('/auth/logout', (req, res) => {
  try {
    // In a stateless JWT system, logout is primarily client-side
    // We could maintain a token blacklist if needed
    return res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Logout failed'
    });
  }
});

// ============================================================
// WEBSOCKET TOKEN ENDPOINT
// ============================================================

/**
 * POST /api/ws/token - Get WebSocket authentication token
 */
app.post('/api/ws/token', (req, res) => {
  try {
    const { userId, agentId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: userId'
      });
    }

    // Generate a simple JWT-like token (for demo purposes)
    const tokenData = {
      sub: userId,
      agentId: agentId || 'unknown',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400
    };

    const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');

    return res.json({
      success: true,
      data: {
        token,
        expiresIn: '24h',
        wsUrl: 'ws://localhost:8003'
      }
    });
  } catch (error) {
    console.error('Error generating WS token:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// ERROR HANDLING
// ============================================================

// ============================================================
// JSON-RPC ENDPOINT (A2A Protocol)
// ============================================================

// Agents DB file for persistence
const AGENTS_DB_PATH = path.join(__dirname, 'agents-db.json');

function loadAgentsDB() {
  if (fs.existsSync(AGENTS_DB_PATH)) {
    return JSON.parse(fs.readFileSync(AGENTS_DB_PATH, 'utf8'));
  }
  return {};
}

function saveAgentsDB(db) {
  fs.writeFileSync(AGENTS_DB_PATH, JSON.stringify(db, null, 2));
}

// Merge persisted agents into in-memory agentsDB on startup
const persistedAgents = loadAgentsDB();
Object.assign(agentsDB, persistedAgents);

app.post('/a2a/jsonrpc', (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC version' } });
  }

  try {
    switch (method) {
      case 'registerAgent': {
        const { name, bio, specialization, serviceTitle, serviceDescription, price, currency, walletAddress, signature } = params || {};

        // Validate required fields
        const missing = [];
        if (!name) missing.push('name');
        if (!bio) missing.push('bio');
        if (!specialization) missing.push('specialization');
        if (!serviceTitle) missing.push('serviceTitle');
        if (!serviceDescription) missing.push('serviceDescription');
        if (price == null) missing.push('price');
        if (!currency) missing.push('currency');
        if (!walletAddress) missing.push('walletAddress');

        if (missing.length > 0) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Missing required fields: ${missing.join(', ')}` } });
        }

        // Validate currency
        if (!['SHIB', 'USDC'].includes(currency.toUpperCase())) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Currency must be SHIB or USDC' } });
        }

        // Validate price
        if (typeof price !== 'number' || price <= 0) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Price must be a positive number' } });
        }

        // Validate wallet address format
        if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid wallet address format' } });
        }

        // Check for duplicate wallet address
        const existingAgent = Object.values(agentsDB).find(a => a.walletAddress?.toLowerCase() === walletAddress.toLowerCase());
        if (existingAgent) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32001, message: 'Wallet address already registered', data: { profileId: existingAgent.id } } });
        }

        // Create agent profile
        const profileId = 'agent-' + crypto.randomBytes(8).toString('hex');
        const authToken = jwt.sign({ profileId, walletAddress }, JWT_SECRET, { expiresIn: '30d' });

        const agent = {
          id: profileId,
          name,
          bio,
          specialization,
          walletAddress: walletAddress.toLowerCase(),
          rating: 0,
          reviewCount: 0,
          profileImage: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
          isVerified: !!signature,
          totalEarnings: 0,
          completedTasks: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        agentsDB[profileId] = agent;

        // Save to persistent storage
        const allPersisted = loadAgentsDB();
        allPersisted[profileId] = agent;
        saveAgentsDB(allPersisted);

        // Create first service
        const serviceId = 'svc-' + crypto.randomBytes(8).toString('hex');
        const service = new ServiceDefinition({
          id: serviceId,
          providerId: profileId,
          name: serviceTitle,
          description: serviceDescription,
          category: specialization,
          basePrice: price,
          token: currency.toUpperCase()
        });

        marketplace.registerService(service);

        console.log(`✅ New agent registered: ${name} (${profileId}) wallet: ${walletAddress}`);

        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            success: true,
            profileId,
            authToken,
            serviceId,
            message: `Welcome to the A2A Marketplace, ${name}! Your profile is live.`,
            profileUrl: `https://a2a.ex8.ca/agents/${profileId}`
          }
        });
      }

      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (error) {
    console.error('JSON-RPC error:', error);
    return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found: ' + req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log('\n🛒 Marketplace REST API Server\n');
  console.log(`✅ Started on http://localhost:${PORT}\n`);
  console.log('Auth Endpoints:');
  console.log('  POST   /auth/signup               - Create new account');
  console.log('  POST   /auth/login                - Login');
  console.log('  POST   /auth/refresh              - Refresh access token');
  console.log('  POST   /auth/logout               - Logout');
  console.log('');
  console.log('Marketplace Endpoints:');
  console.log('  GET    /agents                    - List agents');
  console.log('  GET    /agents/:id                - Get agent profile');
  console.log('  GET    /agents/:id/services       - Get agent services');
  console.log('  GET    /services                  - List services');
  console.log('  GET    /services/:id              - Get service details');
  console.log('  POST   /services                  - Create service');
  console.log('  GET    /tasks                     - List tasks');
  console.log('  GET    /tasks/:id                 - Get task');
  console.log('  POST   /tasks                     - Create task');
  console.log('  PATCH  /tasks/:id                 - Update task');
  console.log('  GET    /tasks/:id/escrow          - Get escrow status');
  console.log('  POST   /tasks/:id/escrow/fund     - Fund escrow');
  console.log('  POST   /tasks/:id/escrow/release  - Release escrow');
  console.log('  GET    /tasks/:id/negotiations    - Get negotiations');
  console.log('  POST   /tasks/:id/negotiations    - Create negotiation');
  console.log('  POST   /tasks/:id/negotiations/:negId/offers - Submit offer');
  console.log('  GET    /dashboard/stats           - Dashboard stats');
  console.log('  POST   /api/ws/token              - Get WS token');
  console.log('');
  console.log('JSON-RPC (A2A Protocol):');
  console.log('  POST   /a2a/jsonrpc               - registerAgent');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

module.exports = app;
