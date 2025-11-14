# 🚀 Netlify Functions Deployment Guide

## ⚙️ **Build Settings for Netlify:**

### **Build Command:**
```bash
npm install
```

### **Functions Directory:**
```
netlify/functions
```

### **Publish Directory:**
```
. 
```
(Root directory - leave empty or use ".")

## 🔑 **Environment Variables:**

Add these in your Netlify dashboard → Site Settings → Environment Variables:

```bash
JWT_SECRET=your-super-secure-jwt-secret-key-here
NODE_ENV=production
```

## 📁 **Project Structure:**
```
backend/
├── netlify/
│   └── functions/
│       └── api.js          # Main serverless function
├── netlify.toml            # Netlify configuration
├── package.json            # Dependencies
├── server.js              # Original Express server (for local dev)
└── .gitignore
```

## 🌐 **API Endpoints:**

After deployment, your API will be available at:
```
https://your-backend-site.netlify.app/.netlify/functions/api/login
https://your-backend-site.netlify.app/.netlify/functions/api/events
https://your-backend-site.netlify.app/.netlify/functions/api/display/code/ABC123
```

But thanks to the redirect rules in `netlify.toml`, you can also use:
```
https://your-backend-site.netlify.app/api/login
https://your-backend-site.netlify.app/api/events
https://your-backend-site.netlify.app/api/display/code/ABC123
```

## 🔧 **Deployment Steps:**

### 1. **Push to GitHub:**
```bash
git add .
git commit -m "Convert to Netlify Functions"
git push origin main
```

### 2. **Deploy to Netlify:**
- Go to [Netlify](https://netlify.com)
- Click "New site from Git"
- Connect your backend repository
- Configure build settings:
  - **Build command:** `npm install`
  - **Functions directory:** `netlify/functions`
  - **Publish directory:** `.` (root)

### 3. **Set Environment Variables:**
- Go to Site Settings → Environment Variables
- Add `JWT_SECRET` with a secure value
- Add `NODE_ENV` set to `production`

### 4. **Update Frontend Configuration:**
In your frontend repository, update the environment variables:
```bash
REACT_APP_API_URL=https://your-backend-site.netlify.app
REACT_APP_SOCKET_URL=https://your-backend-site.netlify.app
```

## ⚠️ **Important Notes:**

### **Limitations of Netlify Functions:**
1. **No Real-time WebSockets:** Socket.IO won't work with serverless functions
2. **Stateless:** No in-memory storage persistence between requests
3. **Cold Starts:** Functions may have startup delays
4. **15-second Timeout:** Functions must complete within 15 seconds

### **Recommended Architecture:**
For a full-featured app, consider:
1. **API Functions on Netlify** (authentication, CRUD operations)
2. **Real-time Backend on Heroku/Railway** (Socket.IO, timers)
3. **Frontend on Netlify** (React app)

## 🔄 **Hybrid Approach (Recommended):**

### **Split Services:**
1. **Static APIs → Netlify Functions**
   - Login/authentication
   - Event CRUD operations
   - Display code validation

2. **Real-time Features → Heroku/Railway**
   - Socket.IO for live updates
   - Timer management
   - Active event state

### **Update Frontend to Use Both:**
```javascript
// In frontend/src/config.js
export const API_BASE_URL = 'https://your-backend.netlify.app';
export const SOCKET_URL = 'https://your-realtime.herokuapp.com';
```

## 🧪 **Testing Your Deployment:**

### **Test Endpoints:**
```bash
# Health check
curl https://your-backend.netlify.app/api/health

# Login test
curl -X POST https://your-backend.netlify.app/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

## 🎯 **Success Indicators:**

✅ **Netlify Functions working:** API endpoints return responses  
✅ **Environment variables set:** JWT_SECRET configured  
✅ **CORS configured:** Frontend can connect to backend  
✅ **Frontend updated:** API URLs point to Netlify Functions  

## 🔧 **Troubleshooting:**

### **Function Errors:**
- Check Netlify Function logs in dashboard
- Verify environment variables are set
- Test functions locally with `netlify dev`

### **CORS Issues:**
- Ensure CORS is configured for your frontend domain
- Check browser network tab for preflight requests

### **Authentication Problems:**
- Verify JWT_SECRET matches between environments
- Check token expiration and format

Your backend is now ready for serverless deployment! 🚀