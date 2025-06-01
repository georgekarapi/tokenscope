# TokenScope - DEX Price Comparison

Real-time token price comparison across multiple decentralized exchanges using **authenticated WebSocket architecture**.

## 🚀 Architecture (Authenticated WebSocket Proxy)

```
Frontend <---> Authenticated Nuxt API <---> Cloudflare Durable Object
```

### Why Authenticated Proxy?
- **Authentication**: JWT-based access control to price data
- **Security**: Server-side token validation before Durable Object access
- **User Management**: Per-user sessions and access control
- **Real-time**: WebSocket connections for instant updates
- **Scalable**: Each authenticated user gets dedicated Durable Object connection

## 🏗️ Components

### 1. Authenticated Nuxt API (`server/api/priceFeed.ts`)
- **JWT Authentication**: Validates user tokens before allowing access
- **WebSocket Proxy**: Forwards messages between frontend and Durable Object
- **Connection Management**: Maintains authenticated user sessions
- **Security**: Blocks unauthenticated access to price data

### 2. Cloudflare Durable Object (`cloudflare/pricing-durable-object.ts`)
- **WebSocket Server**: Handles connections from authenticated API
- **Token Registry**: Manages monitored tokens (WETH, WBTC, UNI)
- **Price Fetching**: Gets live prices from DEXes using `lib/priceUtils.ts`

### 3. Frontend (`pages/index.vue`)
- **Authenticated WebSocket**: Connects to Nuxt API with JWT token
- **Authentication UI**: Shows user status and authentication state
- **Real-time Price Table**: Shows prices after authentication

### 4. Price Utils (`lib/priceUtils.ts`)
- **Multi-DEX Support**: Uniswap V3/V2, SushiSwap, Curve
- **Raw Wei Prices**: Returns unprocessed prices for frontend calculation
- **Pool Discovery**: Finds best liquidity pools automatically

## 🔐 Authentication Flow

### 1. Initial Connection
```typescript
// Frontend connects to Nuxt API
const ws = new WebSocket('ws://localhost:3000/api/priceFeed')

// API requests authentication
{ type: 'auth', data: { message: 'Authentication required' } }
```

### 2. Authentication
```typescript
// Frontend sends JWT token
{ type: 'auth', authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }

// API validates token and creates Durable Object connection
{ type: 'connected', data: { userId: 'user123', message: 'Authenticated successfully' } }
```

### 3. Data Access
```typescript
// All subsequent messages are proxied to Durable Object
{ type: 'prices' } // Get current prices
{ type: 'tokens' } // Get token registry
```

## 📡 WebSocket Messages

### Client → Nuxt API
```typescript
// Authentication
{ type: 'auth', authToken: 'jwt-token-here' }

// After authentication:
{ type: 'prices' } // Get current prices
{ type: 'tokens' } // Get token registry
{ type: 'ping' }   // Keep-alive
```

### Nuxt API → Client
```typescript
// Authentication request
{ type: 'auth', data: { message: 'Authentication required' } }

// Authentication success
{ type: 'connected', data: { userId: 'user123', message: 'Authenticated' } }

// Data (proxied from Durable Object)
{ type: 'prices', data: TokenInfo[] }
{ type: 'tokens', data: TokenInfo[] }
{ type: 'error', message: 'Authentication required' }
```

## 🔧 Development

### Local Development
```bash
# Start Durable Object (Terminal 1)
cd cloudflare
npm run dev

# Start Authenticated Frontend (Terminal 2)  
npm run dev
```

### Authentication Setup
For **development**, the system uses mock JWT tokens automatically.

For **production**, set your JWT secret:
```bash
# Set in your deployment environment
JWT_SECRET=your-super-secret-jwt-key
```

### Configuration
- **Local**: Frontend connects to `ws://localhost:3000/api/priceFeed`
- **Production**: Frontend connects to your deployed Nuxt.js domain

## 🔑 JWT Token Format

### Development (Mock)
```javascript
// Automatically generated mock token
{
  "userId": "demo-user-abc123",
  "exp": 1234567890
}
```

### Production
```javascript
// Your authentication system should provide:
{
  "userId": "actual-user-id",
  "email": "user@example.com", // optional
  "role": "premium", // optional
  "exp": 1234567890
}
```

## 🎯 Benefits of Authenticated Architecture

1. **Secure Access**: Only authenticated users can access price data
2. **User Sessions**: Per-user WebSocket connections and state
3. **Rate Limiting**: Can implement per-user rate limits
4. **Analytics**: Track usage per authenticated user
5. **Premium Features**: Different access levels based on authentication
6. **Real-time**: Still maintains instant WebSocket updates

## 🚀 Deployment

1. **Deploy Durable Object**:
   ```bash
   cd cloudflare
   npm run deploy
   ```

2. **Set Production JWT Secret**:
   ```bash
   # In your hosting environment
   export JWT_SECRET=your-production-secret
   ```

3. **Deploy Authenticated Frontend**:
   ```bash
   npm run build
   npm run preview
   ```

## 📊 Supported DEXes

- **Uniswap V3**: Multiple fee tiers (0.01%, 0.05%, 0.3%, 1%)
- **Uniswap V2**: Standard AMM pools  
- **SushiSwap**: Multi-chain DEX pools
- **Curve Finance**: Stablecoin and crypto pools

## 🔒 Security Features

- **JWT Validation**: Server-side token verification
- **Connection Isolation**: Each user gets separate Durable Object connection
- **Auto-reconnection**: Maintains authentication across reconnects
- **Token Refresh**: Handles expired tokens gracefully
- **Development Mode**: Mock tokens for easy local development

---

**Authenticated real-time DEX pricing!** Secure WebSocket architecture with JWT authentication. 🔐🚀
