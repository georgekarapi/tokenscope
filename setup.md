# Quick Setup Guide

## Architecture
```
Nuxt.js Frontend ↔ Server API ↔ Cloudflare Durable Object ↔ DEXes
```

## 1. Install Dependencies

```bash
npm run setup
```

This installs dependencies for both the main project and the Cloudflare Durable Object.

## 2. Set Environment Variables

```bash
export NUXT_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/your-api-key"
```

## 3. Start Development (Unified)

```bash
npm run dev
```

This **single command** starts both:
- **Nuxt.js frontend** on `http://localhost:3000`
- **Durable Object** locally on `http://localhost:8787`

You'll see colored output in your terminal:
```
[Nuxt]   🚀 Server ready at http://localhost:3000
[Durable] ⚡ Ready on http://localhost:8787
```

## 4. Test the Connection

1. Open `http://localhost:3000`
2. Click on any token pair button (e.g., WETH/USDC)
3. You should see **real-time price data** from the local Durable Object
4. Check browser console - should show "Connected" status

## 5. Alternative Development Modes

### Frontend Only (Mock Data)
```bash
npm run dev:nuxt-only
```
Good for UI development when you don't need real price data.

### Individual Services
```bash
# Terminal 1: Nuxt.js only
npm run dev:nuxt

# Terminal 2: Durable Object only
npm run dev:durable-object
```

## 6. Deploy to Production

```bash
npm run durable-object:deploy
```

Then update the production URL in `server/api/priceFeed.ts`.

## Key Benefits of Unified Development

- **Single command** - No need to manage multiple terminals
- **Real-time data** - Connect to actual Durable Object locally
- **Colored output** - Easy to distinguish between services
- **Auto-restart** - Both services restart on file changes
- **Environment detection** - Automatically uses localhost in development

## Troubleshooting

- **Connection Issues**: Both services should start automatically
- **Port conflicts**: Durable Object uses port 8787, Nuxt.js uses 3000
- **No real data**: Falls back to mock data if Durable Object unavailable
- **TypeScript Errors**: Run `npm run build` to check compilation

The unified development experience makes it much easier to develop and test the full real-time pricing system! 