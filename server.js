const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://cronology.netlify.app"
    ],
    methods: ["GET", "POST"]
  }
});

const PORT = 5000;
const JWT_SECRET = 'church-event-secret-key';

// Middleware
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://cronology.netlify.app"
  ],
  credentials: true
}));
app.use(express.json());

// In-memory data storage (replace with database in production)
const users = [
  {
    id: 1,
    username: 'admin',
    password: '$2b$10$S6sg9uJda4EDdoKAjvIf6uRI.MKi9OiTofBAV64BErNY61qGGm.ba', // 'admin123'
    role: 'super_admin',
    churchName: 'Grace Community Church'
  },
  {
    id: 2,
    username: 'pastor',
    password: '$2b$10$S6sg9uJda4EDdoKAjvIf6uRI.MKi9OiTofBAV64BErNY61qGGm.ba', // 'admin123'
    role: 'event_manager',
    churchName: 'Grace Community Church'
  }
];

const events = [];
const templates = [];
const activeTimers = {}; // Store active timer states
const displayCodes = {}; // Store display code mappings: { code: eventId }
const displaySessions = {}; // Store display sessions: { sessionId: { eventId, createdAt, expiresAt } }
let eventId = 1;
let templateId = 1;

// Generate unique display code
function generateDisplayCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing characters
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (displayCodes[code]); // Ensure uniqueness
  return code;
}

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid token.' });
  }
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('joinEvent', (eventId) => {
    socket.join(`event_${eventId}`);
    console.log(`Socket ${socket.id} joined event ${eventId} room`);
  });

  socket.on('displaySettingsChanged', (data) => {
    console.log('Display settings changed:', data);
    // Broadcast display settings to all clients in the event room
    socket.to(`event_${data.eventId}`).emit('displaySettingsChanged', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Authentication Routes
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      churchName: user.churchName
    }
  });
});

// Event Routes
app.get('/api/events', verifyToken, (req, res) => {
  res.json(events);
});

app.post('/api/events', verifyToken, (req, res) => {
  const displayCode = generateDisplayCode();
  
  const event = {
    id: eventId++,
    ...req.body,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    status: 'scheduled', // scheduled, active, paused, completed
    currentActivityIndex: 0,
    activities: req.body.activities || [],
    displayCode: displayCode,
    autoAdvance: true, // Default to auto-advance enabled
    allowNegativeTime: true // Default to allow negative time
  };
  
  // Store the display code mapping
  displayCodes[displayCode] = event.id;
  
  events.push(event);
  res.status(201).json(event);
});

app.get('/api/events/:id', (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (event) {
    res.json(event);
  } else {
    res.status(404).json({ error: 'Event not found' });
  }
});

app.put('/api/events/:id', verifyToken, (req, res) => {
  const eventIndex = events.findIndex(e => e.id === parseInt(req.params.id));
  if (eventIndex === -1) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  events[eventIndex] = { ...events[eventIndex], ...req.body };
  
  // Emit update to all connected clients
  io.to(`event_${req.params.id}`).emit('eventUpdated', events[eventIndex]);
  
  res.json(events[eventIndex]);
});

// Timer Control Routes
app.post('/api/events/:id/start', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  event.status = 'active';
  event.startedAt = new Date().toISOString();
  
  // Initialize timer state
  const now = new Date().getTime();
  const currentActivity = event.activities[event.currentActivityIndex || 0];
  activeTimers[event.id] = {
    eventId: event.id,
    currentActivityIndex: event.currentActivityIndex || 0,
    activityStartTime: now,
    lastTickTime: now,
    remainingTime: currentActivity ? currentActivity.duration * 60000 : 0,
    isPaused: false
  };
  
  // Emit to all connected clients
  io.to(`event_${event.id}`).emit('eventStarted', event);
  
  res.json(event);
});

app.post('/api/events/:id/pause', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  event.status = 'paused';
  if (activeTimers[event.id]) {
    activeTimers[event.id].isPaused = true;
  }
  
  io.to(`event_${event.id}`).emit('eventPaused', event);
  
  res.json(event);
});

app.post('/api/events/:id/resume', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  event.status = 'active';
  if (activeTimers[event.id]) {
    activeTimers[event.id].isPaused = false;
  }
  
  io.to(`event_${event.id}`).emit('eventResumed', event);
  
  res.json(event);
});

app.post('/api/events/:id/next-activity', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  if (event.currentActivityIndex < event.activities.length - 1) {
    event.currentActivityIndex++;
    
    if (activeTimers[event.id]) {
      activeTimers[event.id].currentActivityIndex = event.currentActivityIndex;
      activeTimers[event.id].activityStartTime = new Date().getTime();
    }
    
    io.to(`event_${event.id}`).emit('activityChanged', {
      event,
      currentActivity: event.activities[event.currentActivityIndex]
    });
  }
  
  res.json(event);
});

app.post('/api/events/:id/goto-activity', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  const { activityIndex } = req.body;
  
  if (activityIndex >= 0 && activityIndex < event.activities.length) {
    event.currentActivityIndex = activityIndex;
    
    // Reset timer for the new activity
    if (activeTimers[event.id]) {
      activeTimers[event.id].currentActivityIndex = event.currentActivityIndex;
      activeTimers[event.id].activityStartTime = new Date().getTime();
      activeTimers[event.id].lastTickTime = new Date().getTime();
      activeTimers[event.id].remainingTime = event.activities[activityIndex].duration * 60000; // Reset to full duration
      
      console.log(`Jumped to activity ${activityIndex}, timer reset to ${event.activities[activityIndex].duration} minutes`);
    }
    
    io.to(`event_${event.id}`).emit('activityChanged', {
      event,
      currentActivity: event.activities[event.currentActivityIndex],
      timerReset: true,
      remainingTime: activeTimers[event.id] ? activeTimers[event.id].remainingTime : event.activities[activityIndex].duration * 60
    });
  }
  
  res.json(event);
});

// Extend time for current activity
app.post('/api/events/:id/extend-time', verifyToken, (req, res) => {
  console.log(`[EXTEND-TIME] Request received for event ${req.params.id}, minutes: ${req.body.minutes}`);
  
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    console.log(`[EXTEND-TIME] Event not found: ${req.params.id}`);
    return res.status(404).json({ error: 'Event not found' });
  }
  
  const { minutes } = req.body;
  console.log(`[EXTEND-TIME] Event found: ${event.name}, Status: ${event.status}, CurrentActivity: ${event.currentActivityIndex}`);
  
  const currentActivity = event.activities[event.currentActivityIndex];
  
  if (currentActivity && activeTimers[event.id]) {
    const oldTime = activeTimers[event.id].remainingTime;
    // Extend the remaining time (convert minutes to milliseconds)
    activeTimers[event.id].remainingTime += minutes * 60 * 1000;
    const newTime = activeTimers[event.id].remainingTime;
    
    console.log(`[EXTEND-TIME] Timer extended: ${minutes} minutes (${minutes * 60 * 1000} milliseconds)`);
    console.log(`[EXTEND-TIME] Time changed: ${oldTime}ms -> ${newTime}ms`);
    
    io.to(`event_${event.id}`).emit('timerExtended', {
      event,
      extendedMinutes: minutes,
      newRemainingTime: activeTimers[event.id].remainingTime
    });
  } else {
    console.log(`[EXTEND-TIME] Cannot extend - currentActivity: ${!!currentActivity}, activeTimer: ${!!activeTimers[event.id]}`);
  }
  
  res.json(event);
});

// Reset timer for current activity
app.post('/api/events/:id/reset-timer', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  const currentActivity = event.activities[event.currentActivityIndex];
  
  if (currentActivity && activeTimers[event.id]) {
    // Reset timer to full duration
    activeTimers[event.id].remainingTime = currentActivity.duration * 60000;
    activeTimers[event.id].activityStartTime = new Date().getTime();
    activeTimers[event.id].lastTickTime = new Date().getTime();
    
    console.log(`Timer reset for event ${event.id}, activity: ${currentActivity.name}`);
    
    io.to(`event_${event.id}`).emit('timerReset', {
      event,
      currentActivity,
      resetTime: activeTimers[event.id].remainingTime
    });
  }
  
  res.json(event);
});

// Toggle auto-advance
app.post('/api/events/:id/auto-advance', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  const { autoAdvance } = req.body;
  event.autoAdvance = autoAdvance;
  
  console.log(`Auto-advance ${autoAdvance ? 'enabled' : 'disabled'} for event ${event.id}`);
  
  io.to(`event_${event.id}`).emit('autoAdvanceChanged', {
    event,
    autoAdvance
  });
  
  res.json(event);
});

// Toggle allow negative time
app.post('/api/events/:id/allow-negative-time', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  const { allowNegativeTime } = req.body;
  event.allowNegativeTime = allowNegativeTime;
  
  console.log(`Allow negative time ${allowNegativeTime ? 'enabled' : 'disabled'} for event ${event.id}`);
  
  io.to(`event_${event.id}`).emit('allowNegativeTimeChanged', {
    event,
    allowNegativeTime
  });
  
  res.json(event);
});

// Display Code Routes
app.get('/api/display/code/:code', (req, res) => {
  const code = req.params.code.toUpperCase().trim();
  
  // Validate code format (6 characters, alphanumeric)
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code format. Must be 6 alphanumeric characters.' });
  }
  
  const eventId = displayCodes[code];
  
  if (!eventId) {
    console.log(`Display code lookup failed: ${code}`);
    return res.status(404).json({ error: 'Display code not found. Please check the code and try again.' });
  }
  
  const event = events.find(e => e.id === eventId);
  if (!event) {
    console.log(`Event not found for valid display code: ${code} -> eventId: ${eventId}`);
    return res.status(404).json({ error: 'Event not found for this code' });
  }
  
  // Create a display session (valid for 24 hours)
  const sessionId = generateDisplayCode(); // Reuse the same generator for session IDs
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  
  displaySessions[sessionId] = {
    eventId,
    createdAt: now,
    expiresAt
  };
  
  console.log(`Display code verified: ${code} -> Event: ${event.name}, Session: ${sessionId}`);
  res.json({ eventId, event, sessionId });
});

// Verify display session
app.get('/api/display/session/:sessionId/event/:eventId', (req, res) => {
  const { sessionId, eventId } = req.params;
  
  const session = displaySessions[sessionId];
  if (!session) {
    return res.status(401).json({ error: 'Invalid session. Please enter display code again.' });
  }
  
  // Check if session is expired
  if (new Date() > session.expiresAt) {
    delete displaySessions[sessionId];
    return res.status(401).json({ error: 'Session expired. Please enter display code again.' });
  }
  
  // Check if session matches the requested event
  if (session.eventId !== parseInt(eventId)) {
    return res.status(403).json({ error: 'Session does not match requested event.' });
  }
  
  const event = events.find(e => e.id === parseInt(eventId));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  res.json({ valid: true, event });
});

app.get('/api/events/:id/display-code', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  res.json({ displayCode: event.displayCode });
});

// Generate new display code for an event
app.post('/api/events/:id/regenerate-code', verifyToken, (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  // Remove old code mapping
  if (event.displayCode) {
    delete displayCodes[event.displayCode];
  }
  
  // Generate new code
  const newCode = generateDisplayCode();
  event.displayCode = newCode;
  displayCodes[newCode] = event.id;
  
  res.json({ displayCode: newCode });
});

// Template Routes
app.get('/api/templates', verifyToken, (req, res) => {
  res.json(templates);
});

app.post('/api/templates', verifyToken, (req, res) => {
  const template = {
    id: templateId++,
    ...req.body,
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  
  templates.push(template);
  res.status(201).json(template);
});

// Get current timer state for display
app.get('/api/events/:id/timer-state', (req, res) => {
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  const timerState = activeTimers[event.id];
  res.json({
    event,
    timerState,
    currentActivity: event.activities[event.currentActivityIndex] || null,
    nextActivity: event.activities[event.currentActivityIndex + 1] || null
  });
});

// Timer update system
setInterval(() => {
  Object.keys(activeTimers).forEach(eventId => {
    const timer = activeTimers[eventId];
    const event = events.find(e => e.id === parseInt(eventId));
    
    if (!event || event.status !== 'active' || timer.isPaused) return;
    
    const now = new Date().getTime();
    const currentActivity = event.activities[timer.currentActivityIndex];
    
    if (!currentActivity) return;
    
    // Calculate time since last tick to preserve extensions
    const timeSinceLastTick = now - (timer.lastTickTime || timer.activityStartTime);
    timer.lastTickTime = now;
    
    // Decrement remaining time by actual elapsed time (preserves extensions)
    timer.remainingTime -= timeSinceLastTick;
    
    const remaining = timer.remainingTime;
    
    // Calculate elapsed time for this activity
    const elapsed = now - timer.activityStartTime;
    
    // Emit timer update to all connected clients in this event room
    io.to(`event_${eventId}`).emit('timerTick', {
      eventId: parseInt(eventId),
      currentActivity,
      remainingTime: remaining,
      elapsed: elapsed,
      event: event,
      activityDuration: currentActivity.duration
    });
    
    // Auto-advance to next activity if time is up and auto-advance is enabled
    if (remaining <= -5000 && event.autoAdvance && timer.currentActivityIndex < event.activities.length - 1) {
      // Wait 5 seconds in negative before auto-advancing
      timer.currentActivityIndex++;
      event.currentActivityIndex++;
      timer.activityStartTime = now;
      timer.lastTickTime = now;
      timer.remainingTime = event.activities[timer.currentActivityIndex].duration * 60000;
      
      console.log(`Auto-advanced from activity ${timer.currentActivityIndex - 1} to ${timer.currentActivityIndex}`);
      
      io.to(`event_${eventId}`).emit('activityChanged', {
        event,
        currentActivity: event.activities[event.currentActivityIndex],
        autoAdvanced: true,
        timerReset: true
      });
    }
  });
}, 1000); // Update every second

// Health check endpoint for container orchestration
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

server.listen(PORT, () => {
  console.log(`Church Event Management Server running on http://localhost:${PORT}`);
});
