/// <reference types="@cloudflare/workers-types" />

import { ethers } from 'ethers';
import { PriceService } from '../lib/priceUtils';

// Environment interface for TypeScript
export interface Env {
    ETHEREUM_RPC_URL?: string;
    MORALIS_API_KEY?: string;
    PRICING_DURABLE_OBJECT: DurableObjectNamespace;
}

// DEX price information
interface DexPriceInfo {
    priceInWei: string; // Always in ETH wei (18 decimals) - how much ETH wei needed for 1 full unit of token
    poolAddress: string;
    liquidity: string;
    fee?: number;
    error?: string;
    lastUpdate: number;
}

// Token information with integrated price data
interface TokenInfo {
    symbol: string;
    address: string;
    decimals: number;
    name?: string;
    dexPrices: {
        [dexName: string]: DexPriceInfo;
    };
    lastUpdate: number;
    initialized: boolean; // Track if token has been loaded at least once
}

// Client session with subscription preferences
interface ClientSession {
    id: string;
    webSocket: WebSocket;
    subscribedTokens: Set<string>; // token addresses
    lastActivity: number;
    metadata?: any; // Additional client metadata
}

// WebSocket message types
interface WebSocketMessage {
    type: 'tokens' | 'ping' | 'pong' | 'error' | 'subscribe' | 'unsubscribe';
    data?: TokenInfo[];
    message?: string;
    timestamp?: number;
    clientId?: string;
    tokenAddresses?: string[];
    isWelcome?: boolean; // Indicates this is the initial connection message
}

const FEATURED_TOKENS = new Map<string, TokenInfo>([
    ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', {
        symbol: 'WETH',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        decimals: 18,
        name: 'Wrapped Ether',
        dexPrices: {},
        lastUpdate: 0,
        initialized: false
    }],
    ['0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', {
        symbol: 'WBTC',
        address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        decimals: 8,
        name: 'Wrapped BTC',
        dexPrices: {},
        lastUpdate: 0,
        initialized: false
    }],
    ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', {
        symbol: 'UNI',
        address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
        decimals: 18,
        name: 'Uniswap',
        dexPrices: {},
        lastUpdate: 0,
        initialized: false
    }]
]);

export class PricingDurableObject {
    private sessions: Map<string, ClientSession> = new Map();
    private provider: ethers.Provider | null = null;
    private priceService: PriceService | null = null;
    private tokenRegistry: Map<string, TokenInfo> = new Map(FEATURED_TOKENS);

    // Token-to-clients mapping for efficient updates
    private tokenSubscribers: Map<string, Set<string>> = new Map();

    constructor(ctx: DurableObjectState, env: Env) {
        this.initializeProvider(env);
        this.initializeTokenSubscribers();
    }

    private initializeProvider(env: Env) {
        const rpcUrl = env.ETHEREUM_RPC_URL;
        const moralisApiKey = env.MORALIS_API_KEY;

        if (!rpcUrl) {
            console.error('[Provider] ❌ ETHEREUM_RPC_URL environment variable not set');
            return;
        }

        if (!moralisApiKey) {
            console.error('[Provider] ⚠️ MORALIS_API_KEY environment variable not set - API calls may be limited');
        }

        console.log(`[Provider] Connecting to private RPC endpoint`);
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.priceService = new PriceService(this.provider, moralisApiKey as string);

        // Test the connection
        this.provider.getNetwork().then((network) => {
            console.log(`[Provider] ✅ Connected to Ethereum network (chainId: ${network.chainId})`);
        }).catch((error) => {
            console.error(`[Provider] ❌ Failed to connect to RPC:`, error);
        });
    }

    private initializeTokenSubscribers() {
        // Initialize subscriber sets for featured tokens
        for (const tokenAddress of FEATURED_TOKENS.keys()) {
            this.tokenSubscribers.set(tokenAddress, new Set());
        }
    }

    private generateClientId(): string {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private parseSubscriptionFromHeaders(headers: Headers): string[] {
        // Check for custom subscription header
        const subscriptionHeader = headers.get('X-Token-Subscription');

        if (subscriptionHeader) {
            if (subscriptionHeader.toLowerCase() === 'featured') {
                return Array.from(FEATURED_TOKENS.keys());
            } else if (subscriptionHeader.toLowerCase() === 'all') {
                return Array.from(this.tokenRegistry.keys());
            } else {
                // Assume comma-separated token addresses
                return subscriptionHeader.split(',').map(addr => addr.trim());
            }
        }

        // Default to featured tokens
        return Array.from(FEATURED_TOKENS.keys());
    }

    private subscribeClientToToken(clientId: string, tokenAddress: string) {
        const session = this.sessions.get(clientId);
        if (!session) return;

        // Add token to client's subscription list
        session.subscribedTokens.add(tokenAddress);

        // Add client to token's subscriber list
        if (!this.tokenSubscribers.has(tokenAddress)) {
            this.tokenSubscribers.set(tokenAddress, new Set());
        }
        this.tokenSubscribers.get(tokenAddress)!.add(clientId);

        // Ensure token is in registry
        if (!this.tokenRegistry.has(tokenAddress)) {
            // Add placeholder token info that will be updated
            this.tokenRegistry.set(tokenAddress, {
                symbol: 'UNKNOWN',
                address: tokenAddress,
                decimals: 18,
                name: 'Unknown Token',
                dexPrices: {},
                lastUpdate: 0,
                initialized: false
            });
        }
    }

    private unsubscribeClientFromToken(clientId: string, tokenAddress: string) {
        const session = this.sessions.get(clientId);
        if (!session) return;

        // Remove token from client's subscription list
        session.subscribedTokens.delete(tokenAddress);

        // Remove client from token's subscriber list
        const subscribers = this.tokenSubscribers.get(tokenAddress);
        if (subscribers) {
            subscribers.delete(clientId);

            // If no more subscribers, remove from monitoring
            if (subscribers.size === 0) {
                this.tokenSubscribers.delete(tokenAddress);
            }
        }
    }

    private async updateSingleTokenPrice(tokenAddress: string): Promise<boolean> {
        if (!this.priceService) {
            console.error('PriceService not initialized');
            return false;
        }

        const tokenInfo = this.tokenRegistry.get(tokenAddress);
        if (!tokenInfo) {
            console.error(`Token not found in registry: ${tokenAddress}`);
            return false;
        }

        console.log(`[Price Update] Starting update for ${tokenInfo.symbol} (${tokenAddress})`);

        try {
            console.log(`[Price Update] Calling getAllAvailablePrices for ${tokenInfo.symbol}...`);

            const dexPrices = await this.priceService.getAllAvailablePrices(tokenAddress);

            console.log(`[Price Update] Raw response for ${tokenInfo.symbol}:`, {
                count: dexPrices.length,
                dexes: dexPrices.map(p => ({
                    dex: p.dex,
                    priceInWei: p.priceInWei,
                    poolAddress: p.poolAddress?.slice(0, 10) + '...',
                    baseToken: p.baseTokenSymbol
                }))
            });

            const oldPricesJson = JSON.stringify(tokenInfo.dexPrices);
            const wasInitialized = tokenInfo.initialized;

            console.log(`[Price Update] Before update - ${tokenInfo.symbol} was initialized: ${wasInitialized}, had ${Object.keys(tokenInfo.dexPrices).length} existing prices`);

            // Clear existing prices
            tokenInfo.dexPrices = {};

            // Populate new prices
            for (const dexPrice of dexPrices) {
                console.log(`[Price Update] Adding ${dexPrice.dex} price for ${tokenInfo.symbol}:`, {
                    priceInWei: dexPrice.priceInWei,
                    poolAddress: dexPrice.poolAddress?.slice(0, 10) + '...',
                    baseToken: dexPrice.baseTokenSymbol
                });

                tokenInfo.dexPrices[dexPrice.dex] = {
                    priceInWei: dexPrice.priceInWei,
                    poolAddress: dexPrice.poolAddress,
                    liquidity: dexPrice.liquidity,
                    fee: dexPrice.fee,
                    lastUpdate: Date.now()
                };
            }

            tokenInfo.lastUpdate = Date.now();
            tokenInfo.initialized = true; // Mark as initialized after first successful update

            console.log(`[Price Update] After update - ${tokenInfo.symbol} now has ${Object.keys(tokenInfo.dexPrices).length} prices:`,
                Object.keys(tokenInfo.dexPrices)
            );

            // Only consider it a "change" if the token was already initialized AND prices actually changed
            if (wasInitialized) {
                const newPricesJson = JSON.stringify(tokenInfo.dexPrices);
                const pricesChanged = oldPricesJson !== newPricesJson;

                if (pricesChanged) {
                    console.log(`[Price Update] ✅ Actual price changes detected for ${tokenInfo.symbol}`);
                    return true;
                } else {
                    console.log(`[Price Update] ❌ No price changes for ${tokenInfo.symbol}`);
                    return false;
                }
            } else {
                // First time initialization - don't treat as a "change" but log success
                console.log(`[Price Update] 🔄 Initial price load for ${tokenInfo.symbol} - loaded ${Object.keys(tokenInfo.dexPrices).length} prices (not treated as change)`);
                return false;
            }

        } catch (error) {
            console.error(`[Price Update] ❌ Error fetching prices for ${tokenInfo.symbol}:`, error);

            // Don't overwrite existing prices on error, just mark as error if no prices exist
            if (Object.keys(tokenInfo.dexPrices).length === 0) {
                tokenInfo.dexPrices = {
                    'error': {
                        priceInWei: '0',
                        poolAddress: '',
                        liquidity: '0',
                        error: `Failed to fetch prices: ${error}`,
                        lastUpdate: Date.now()
                    }
                };
            }

            tokenInfo.lastUpdate = Date.now();
            tokenInfo.initialized = true; // Mark as initialized even on error

            // Don't treat error as change for initialization
            return false;
        }
    }

    private async updateAllActivePrices(): Promise<void> {
        console.log(`Updating prices for ${this.tokenSubscribers.size} active tokens`);

        const updatePromises = Array.from(this.tokenSubscribers.keys()).map(tokenAddress =>
            this.updateSingleTokenPrice(tokenAddress)
        );

        const results = await Promise.allSettled(updatePromises);

        // Check if any tokens had price changes
        const hasChanges = results.some((result, index) =>
            result.status === 'fulfilled' && result.value === true
        );

        // If any prices changed, notify all clients with their complete token sets
        if (hasChanges) {
            console.log('Price changes detected, notifying all clients');
            await this.notifyAllClients();
        }
    }

    // Silent update that doesn't trigger notifications (for initial loads)
    private async updateAllActivePricesSilent(): Promise<void> {
        console.log(`Silently updating prices for ${this.tokenSubscribers.size} active tokens (no notifications)`);

        const updatePromises = Array.from(this.tokenSubscribers.keys()).map(tokenAddress =>
            this.updateSingleTokenPrice(tokenAddress)
        );

        await Promise.allSettled(updatePromises);
        console.log('Silent price update completed');
    }

    private async notifyAllClients() {
        // Get all unique client IDs from all token subscribers
        const allClientIds = new Set<string>();
        for (const subscribers of this.tokenSubscribers.values()) {
            for (const clientId of subscribers) {
                allClientIds.add(clientId);
            }
        }

        console.log(`[Notification] Notifying ${allClientIds.size} clients`);

        // Send one update per client with their subscribed tokens
        for (const clientId of allClientIds) {
            const session = this.sessions.get(clientId);
            if (session && session.webSocket.readyState === WebSocket.OPEN) {
                try {
                    // Get all subscribed tokens for this client
                    const allSubscribedTokens = Array.from(session.subscribedTokens)
                        .map(addr => this.tokenRegistry.get(addr))
                        .filter(token => token !== undefined) as TokenInfo[];

                    console.log(`[Notification] Sending to client ${clientId}:`, {
                        tokenCount: allSubscribedTokens.length,
                        tokens: allSubscribedTokens.map(t => ({
                            symbol: t.symbol,
                            dexPriceCount: Object.keys(t.dexPrices).length,
                            dexes: Object.keys(t.dexPrices),
                            samplePrice: Object.values(t.dexPrices)[0]?.priceInWei || 'none'
                        }))
                    });

                    const message: WebSocketMessage = {
                        type: 'tokens',
                        data: allSubscribedTokens,
                        timestamp: Date.now()
                    };

                    session.webSocket.send(JSON.stringify(message));
                } catch (error) {
                    console.error(`Failed to send update to client ${clientId}:`, error);
                    // Remove dead client
                    this.removeClient(clientId);
                }
            }
        }
    }

    private removeClient(clientId: string) {
        const session = this.sessions.get(clientId);
        if (!session) return;

        // Remove client from all token subscriber lists
        for (const tokenAddress of session.subscribedTokens) {
            this.unsubscribeClientFromToken(clientId, tokenAddress);
        }

        // Remove the session
        this.sessions.delete(clientId);
    }

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get("Upgrade") === "websocket") {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            // Handle WebSocket asynchronously but don't await it to avoid blocking the response
            this.handleWebSocket(server as WebSocket, request.headers).catch(error => {
                console.error('Error handling WebSocket:', error);
            });

            return new Response(null, {
                status: 101,
                webSocket: client as WebSocket,
            });
        }

        return new Response("Not Found", { status: 404 });
    }

    private async handleWebSocket(webSocket: WebSocket, headers: Headers) {
        (webSocket as any).accept();

        // Create new client session
        const clientId = this.generateClientId();
        const session: ClientSession = {
            id: clientId,
            webSocket,
            subscribedTokens: new Set(),
            lastActivity: Date.now()
        };

        this.sessions.set(clientId, session);

        // Subscribe to tokens based on headers or default to featured
        const initialTokens = this.parseSubscriptionFromHeaders(headers);
        for (const tokenAddress of initialTokens) {
            this.subscribeClientToToken(clientId, tokenAddress);
        }

        // Wait for fresh price data before sending welcome message
        console.log(`[WebSocket] Client ${clientId} connected, fetching fresh prices...`);
        await this.updateAllActivePricesSilent();

        // Send welcome message with fresh subscriptions and token data
        const subscribedTokensData = Array.from(session.subscribedTokens)
            .map(addr => this.tokenRegistry.get(addr))
            .filter(token => token !== undefined) as TokenInfo[];

        console.log(`[WebSocket] Sending welcome message to client ${clientId} with ${subscribedTokensData.length} tokens`);

        webSocket.send(JSON.stringify({
            type: 'tokens',
            data: subscribedTokensData,
            timestamp: Date.now(),
            clientId: session.id,
            isWelcome: true
        }));

        webSocket.addEventListener("message", async (event) => {
            try {
                const message: WebSocketMessage = JSON.parse(event.data as string);
                session.lastActivity = Date.now();

                switch (message.type) {
                    case 'ping':
                        webSocket.send(JSON.stringify({
                            type: 'pong',
                            timestamp: Date.now(),
                            clientId: session.id
                        }));
                        break;

                    case 'subscribe':
                        if (message.tokenAddresses && Array.isArray(message.tokenAddresses)) {
                            for (const tokenAddress of message.tokenAddresses) {
                                if (typeof tokenAddress === 'string' && tokenAddress.length > 0) {
                                    this.subscribeClientToToken(clientId, tokenAddress);
                                }
                            }

                            webSocket.send(JSON.stringify({
                                type: 'subscribe',
                                message: `Subscribed to ${message.tokenAddresses.length} tokens`,
                                tokenAddresses: message.tokenAddresses,
                                timestamp: Date.now(),
                                clientId: session.id
                            }));

                            // Send immediate silent update for newly subscribed tokens (no broadcast notifications)
                            await this.updateAllActivePricesSilent();

                            // Send updated data directly to this client only
                            const updatedTokens = Array.from(session.subscribedTokens)
                                .map(addr => this.tokenRegistry.get(addr))
                                .filter(token => token !== undefined) as TokenInfo[];

                            webSocket.send(JSON.stringify({
                                type: 'tokens',
                                data: updatedTokens,
                                timestamp: Date.now(),
                                clientId: session.id
                            }));
                        } else {
                            webSocket.send(JSON.stringify({
                                type: 'error',
                                message: 'Invalid subscribe message: tokenAddresses must be a non-empty array',
                                timestamp: Date.now(),
                                clientId: session.id
                            }));
                        }
                        break;

                    case 'unsubscribe':
                        if (message.tokenAddresses && Array.isArray(message.tokenAddresses)) {
                            for (const tokenAddress of message.tokenAddresses) {
                                if (typeof tokenAddress === 'string' && tokenAddress.length > 0) {
                                    this.unsubscribeClientFromToken(clientId, tokenAddress);
                                }
                            }

                            webSocket.send(JSON.stringify({
                                type: 'unsubscribe',
                                message: `Unsubscribed from ${message.tokenAddresses.length} tokens`,
                                tokenAddresses: message.tokenAddresses,
                                timestamp: Date.now(),
                                clientId: session.id
                            }));
                        } else {
                            webSocket.send(JSON.stringify({
                                type: 'error',
                                message: 'Invalid unsubscribe message: tokenAddresses must be a non-empty array',
                                timestamp: Date.now(),
                                clientId: session.id
                            }));
                        }
                        break;

                    case 'tokens':
                        const subscribedTokens = Array.from(session.subscribedTokens)
                            .map(addr => this.tokenRegistry.get(addr))
                            .filter(token => token !== undefined) as TokenInfo[];

                        webSocket.send(JSON.stringify({
                            type: 'tokens',
                            data: subscribedTokens,
                            timestamp: Date.now(),
                            clientId: session.id
                        }));
                        break;

                    default:
                        webSocket.send(JSON.stringify({
                            type: 'error',
                            message: `Unknown message type: ${message.type}`,
                            timestamp: Date.now(),
                            clientId: session.id
                        }));
                        break;
                }
            } catch (error) {
                console.error('Error handling WebSocket message:', error);

                // Send error response to client
                try {
                    webSocket.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to parse WebSocket message',
                        timestamp: Date.now(),
                        clientId: session.id
                    }));
                } catch (sendError) {
                    console.error('Failed to send error message to client:', sendError);
                    this.removeClient(clientId);
                }
            }
        });

        webSocket.addEventListener("close", () => {
            this.removeClient(clientId);
        });

        webSocket.addEventListener("error", (error) => {
            console.error('WebSocket error:', error);
            this.removeClient(clientId);
        });
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const id = env.PRICING_DURABLE_OBJECT.idFromName("global-pricing");
        const durableObject = env.PRICING_DURABLE_OBJECT.get(id);
        return durableObject.fetch(request);
    }
}; 