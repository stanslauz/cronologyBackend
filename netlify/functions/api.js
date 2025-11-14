const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();

// CORS configuration for Netlify
app.use(cors({
  origin: true, // Allow all origins in serverless environment
  credentials: true
}));

app.use(express.json());

// Your existing server code (copied from server.js)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// In-memory storage (for demo - use database in production)
let users = [
  { 
    id: 1, 
    username: 'admin', 
    email: 'admin@church.com',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password: 'password'
    role: 'super_admin' 
  }
];

let events = [];
let eventId = 1;
const displayCodes = {}; // Store display code mappings: { code: eventId }
const displaySessions = {}; // Store display sessions: { sessionId: { eventId, createdAt, expiresAt } }
const activeTimers = {};

// JWT verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token.' });
  }
};

// Helper function to generate display codes
function generateDisplayCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (displayCodes[code]); // Ensure uniqueness
  return code;
}

// Authentication Routes
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  const user = users.find(u => u.username === username || u.email === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role 
    }, 
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    }
  });
});

// Events Routes
app.get('/events', verifyToken, (req, res) => {
  res.json(events);
});

app.get('/events/:id', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  res.json(event);
});

app.post('/events', verifyToken, (req, res) => {
  const displayCode = generateDisplayCode();
  
  const event = {
    id: eventId++,
    ...req.body,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    status: 'scheduled',
    currentActivityIndex: 0,
    activities: req.body.activities || [],
    displayCode: displayCode,
    autoAdvance: true,
    allowNegativeTime: true
  };
  
  displayCodes[displayCode] = event.id;
  events.push(event);
  res.status(201).json(event);
});

// Display Code Routes
app.get('/display/code/:code', (req, res) => {
  const code = req.params.code.toUpperCase().trim();
  
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code format. Must be 6 alphanumeric characters.' });
  }
  
  const eventId = displayCodes[code];
  
  if (!eventId) {
    return res.status(404).json({ error: 'Display code not found. Please check the code and try again.' });
  }
  
  const event = events.find(e => e.id === eventId);
  if (!event) {
    return res.status(404).json({ error: 'Event not found for this code' });
  }
  
  const sessionId = generateDisplayCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  displaySessions[sessionId] = {
    eventId,
    createdAt: now,
    expiresAt
  };
  
  res.json({ eventId, event, sessionId });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Export the serverless function
exports.handler = serverless(app);