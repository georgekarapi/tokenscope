import { ethers } from 'ethers';

// Moralis API endpoint
const MORALIS_API_BASE = 'https://deep-index.moralis.io/api/v2.2';

// Contract addresses
const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAP_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const SUSHISWAP_FACTORY = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
const PANCAKESWAP_V2_FACTORY = "0x1097053Fd2ea711dad45caCcc45EfF7548fCB362";
const PANCAKESWAP_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";

// WETH address for consistent pricing
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// ABIs
const ERC20_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const V3_FACTORY_ABI = ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"];
const V2_FACTORY_ABI = ["function getPair(address tokenA, address tokenB) external view returns (address pair)"];
const V3_POOL_ABI = [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function liquidity() external view returns (uint128)"
];
const V2_POOL_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

const V3_FEE_TIERS = [100, 500, 3000, 10000];

export interface PoolResult {
    dex: string;
    poolAddress: string;
    liquidity: string;
    priceInWei: string; // Always in ETH wei (18 decimals) - how much ETH wei needed for 1 full unit of token
    baseToken: string;
    baseTokenSymbol: string;
    fee?: number;
}

// Moralis API response interface
interface MoralisToken {
    address: string;
    symbol: string;
    name: string;
    logo?: string;
    thumbnail?: string;
    decimals: number;
    balance?: string;
}

interface MoralisPairToken {
    token_address: string;
    token_name: string;
    token_symbol: string;
    token_logo?: string;
    token_decimals: string;
    pair_token_type: "token0" | "token1";
    liquidity_usd: number;
}

interface MoralisPair {
    exchange_address: string;
    exchange_name: string;
    exchange_logo?: string;
    pair_label: string;
    pair_address: string;
    usd_price: number;
    usd_price_24hr: number;
    usd_price_24hr_percent_change: number;
    usd_price_24hr_usd_change: number;
    liquidity_usd: number;
    inactive_pair: boolean;
    base_token: string;
    quote_token: string;
    volume_24h_native: number;
    volume_24h_usd: number;
    pair: MoralisPairToken[];
}

interface MoralisResponse {
    pairs?: MoralisPair[];
    page?: number;
    page_size?: number;
    cursor?: string;
}

const mapMoralisDexId = (exchangeName: string): string => {
    if (!exchangeName) return 'unknown';

    const normalizedName = exchangeName.toLowerCase();

    // Pattern-based mapping for flexibility
    if (normalizedName.includes('uniswap') && normalizedName.includes('v3')) {
        return 'uniswap_v3';
    }
    if (normalizedName.includes('uniswap') && normalizedName.includes('v2')) {
        return 'uniswap_v2';
    }
    if (normalizedName.includes('sushiswap')) {
        return 'sushiswap';
    }
    if (normalizedName.includes('pancakeswap') && normalizedName.includes('v3')) {
        return 'pancakeswap_v3';
    }
    if (normalizedName.includes('pancakeswap') && normalizedName.includes('v2')) {
        return 'pancakeswap_v2';
    }

    // Fallback to normalized name
    return normalizedName.replace(/\s+/g, '_');
};

// Get display name for DEX
export const getDexDisplayName = (dexName: string, fee?: number): string => {
    const baseNames: Record<string, string> = {
        'uniswap_v3': 'Uniswap V3',
        'uniswap_v2': 'Uniswap V2',
        'sushiswap': 'SushiSwap',
        'pancakeswap_v3': 'PancakeSwap V3',
        'pancakeswap_v2': 'PancakeSwap V2'
    };

    const baseName = baseNames[dexName] || dexName;

    if (fee !== undefined && (dexName.includes('v3'))) {
        const feePercent = (fee / 10000).toString();
        return `${baseName} (${feePercent}%)`;
    }

    return baseName;
};

export class PriceService {
    private provider: ethers.Provider;
    private moralisApiKey: string;

    constructor(provider: ethers.Provider, moralisApiKey: string) {
        this.provider = provider;
        this.moralisApiKey = moralisApiKey;
    }

    // Get pool liquidity
    private async getPoolLiquidity(poolAddress: string, isV3: boolean): Promise<bigint> {
        console.log(`[DEBUG] getPoolLiquidity: Starting for pool ${poolAddress} (${isV3 ? 'V3' : 'V2'})`);

        try {
            const poolContract = new ethers.Contract(poolAddress, isV3 ? V3_POOL_ABI : V2_POOL_ABI, this.provider);

            if (isV3) {
                console.log(`[DEBUG] getPoolLiquidity: Getting V3 liquidity`);
                const liquidity = await poolContract.liquidity();
                const liquidityBN = BigInt(liquidity.toString());
                console.log(`[DEBUG] getPoolLiquidity: V3 liquidity result: ${liquidityBN}`);
                return liquidityBN;
            } else {
                console.log(`[DEBUG] getPoolLiquidity: Getting V2 reserves`);
                const reserves = await poolContract.getReserves();
                const reserve0 = BigInt(reserves.reserve0.toString());
                const reserve1 = BigInt(reserves.reserve1.toString());
                console.log(`[DEBUG] getPoolLiquidity: V2 reserves - reserve0: ${reserve0}, reserve1: ${reserve1}`);

                if (reserve0 === 0n || reserve1 === 0n) {
                    console.log(`[DEBUG] getPoolLiquidity: V2 has zero reserves, returning 0`);
                    return 0n;
                }

                const liquidityBN = BigInt(Math.sqrt(Number(reserve0 * reserve1)));
                console.log(`[DEBUG] getPoolLiquidity: V2 calculated liquidity: ${liquidityBN}`);
                return liquidityBN;
            }
        } catch (error: any) {
            console.log(`[DEBUG] getPoolLiquidity: ❌ Error getting liquidity for ${poolAddress}:`, error.message);
            return 0n;
        }
    }

    // CORE: Get price in wei from token address and pool address
    async getTokenPriceFromPool(
        tokenAddress: string,
        poolAddress: string
    ): Promise<{ priceInWei: string; baseToken: string; baseTokenSymbol: string } | null> {
        console.log(`[DEBUG] getTokenPriceFromPool: Starting for token ${tokenAddress} in pool ${poolAddress}`);

        try {
            // Try V3 first, then V2
            for (const isV3 of [true, false]) {
                console.log(`[DEBUG] getTokenPriceFromPool: Trying ${isV3 ? 'V3' : 'V2'} for pool ${poolAddress}`);

                try {
                    const poolContract = new ethers.Contract(poolAddress, isV3 ? V3_POOL_ABI : V2_POOL_ABI, this.provider);

                    console.log(`[DEBUG] getTokenPriceFromPool: Getting tokens for pool ${poolAddress}`);
                    const [token0, token1] = await Promise.all([
                        poolContract.token0(),
                        poolContract.token1()
                    ]);

                    console.log(`[DEBUG] getTokenPriceFromPool: Pool tokens - token0: ${token0}, token1: ${token1}`);

                    const [token0Contract, token1Contract] = [
                        new ethers.Contract(token0, ERC20_ABI, this.provider),
                        new ethers.Contract(token1, ERC20_ABI, this.provider)
                    ];

                    console.log(`[DEBUG] getTokenPriceFromPool: Getting token metadata`);
                    const [decimal0, decimal1, symbol0, symbol1] = await Promise.all([
                        token0Contract.decimals(),
                        token1Contract.decimals(),
                        token0Contract.symbol(),
                        token1Contract.symbol()
                    ]);

                    console.log(`[DEBUG] getTokenPriceFromPool: Token metadata - ${symbol0}(${decimal0}) vs ${symbol1}(${decimal1})`);

                    const isTokenToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
                    const otherToken = isTokenToken0 ? token1 : token0;
                    const otherSymbol = isTokenToken0 ? symbol1 : symbol0;

                    console.log(`[DEBUG] getTokenPriceFromPool: Target token is ${isTokenToken0 ? 'token0' : 'token1'}, other token: ${otherSymbol}`);

                    let priceInWei: string;

                    if (isV3) {
                        console.log(`[DEBUG] getTokenPriceFromPool: Calculating V3 price`);
                        const slot0 = await poolContract.slot0();
                        const sqrtPriceBN = BigInt(slot0.sqrtPriceX96);
                        console.log(`[DEBUG] getTokenPriceFromPool: V3 sqrtPriceX96: ${sqrtPriceBN}`);

                        const Q96 = BigInt(2) ** BigInt(96);
                        const decimal0BN = BigInt(10) ** BigInt(decimal0);
                        const decimal1BN = BigInt(10) ** BigInt(decimal1);

                        // In Uniswap V3: sqrtPriceX96 = sqrt(price) * 2^96
                        // where price = token1/token0 in terms of token1 per token0
                        // So price = (sqrtPriceX96 / 2^96)^2

                        if (isTokenToken0) {
                            // Target token is token0, base token is token1
                            // We want: token1 wei per 1 token0 unit
                            // price = token1/token0, so we can use it directly
                            const sqrtPrice = sqrtPriceBN * sqrtPriceBN;
                            // Apply decimal adjustment: multiply by 10^decimal1 and divide by 10^decimal0
                            priceInWei = ((sqrtPrice * decimal1BN) / (Q96 * Q96 * decimal0BN)).toString();

                            console.log(`[DEBUG] getTokenPriceFromPool: V3 price (token0): ${priceInWei} ${otherSymbol} wei per 1 ${symbol0}`);
                        } else {
                            // Target token is token1, base token is token0  
                            // We want: token0 wei per 1 token1 unit
                            // price = token1/token0, so we need 1/price = token0/token1
                            const sqrtPrice = sqrtPriceBN * sqrtPriceBN;
                            // Apply decimal adjustment: multiply by 10^decimal0 and divide by 10^decimal1  
                            priceInWei = ((Q96 * Q96 * decimal0BN * decimal1BN) / (sqrtPrice * decimal1BN)).toString();

                            console.log(`[DEBUG] getTokenPriceFromPool: V3 price (token1): ${priceInWei} ${otherSymbol} wei per 1 ${symbol1}`);
                        }
                    } else {
                        console.log(`[DEBUG] getTokenPriceFromPool: Calculating V2 price`);
                        const reserves = await poolContract.getReserves();
                        const reserve0 = BigInt(reserves.reserve0);
                        const reserve1 = BigInt(reserves.reserve1);

                        console.log(`[DEBUG] getTokenPriceFromPool: V2 reserves - reserve0: ${reserve0}, reserve1: ${reserve1}`);

                        if (reserve0 === 0n || reserve1 === 0n) {
                            console.log(`[DEBUG] getTokenPriceFromPool: V2 empty reserves, skipping`);
                            continue;
                        }

                        const decimal0BN = BigInt(10) ** BigInt(decimal0);
                        const decimal1BN = BigInt(10) ** BigInt(decimal1);

                        if (isTokenToken0) {
                            // Target token is token0, base token is token1
                            // We want: token1 wei per 1 token0 unit
                            // price = reserve1/reserve0, apply decimal adjustment
                            priceInWei = ((reserve1 * decimal1BN) / (reserve0 * decimal0BN)).toString();

                            console.log(`[DEBUG] getTokenPriceFromPool: V2 price (token0): ${priceInWei} ${otherSymbol} wei per 1 ${symbol0}`);
                        } else {
                            // Target token is token1, base token is token0
                            // We want: token0 wei per 1 token1 unit
                            // price = reserve0/reserve1, apply decimal adjustment
                            priceInWei = ((reserve0 * decimal0BN) / (reserve1 * decimal1BN)).toString();

                            console.log(`[DEBUG] getTokenPriceFromPool: V2 price (token1): ${priceInWei} ${otherSymbol} wei per 1 ${symbol1}`);
                        }
                    }

                    const result = {
                        priceInWei,
                        baseToken: otherToken,
                        baseTokenSymbol: otherSymbol
                    };

                    console.log(`[DEBUG] getTokenPriceFromPool: ✅ Success - Price: ${priceInWei} ${otherSymbol}/target`);
                    return result;
                } catch (error: any) {
                    console.log(`[DEBUG] getTokenPriceFromPool: ❌ ${isV3 ? 'V3' : 'V2'} failed for pool ${poolAddress}:`, error.message);
                    continue;
                }
            }
            console.log(`[DEBUG] getTokenPriceFromPool: ❌ Both V3 and V2 failed for pool ${poolAddress}`);
            return null;
        } catch (error) {
            console.error(`[DEBUG] getTokenPriceFromPool: ❌ Fatal error for pool ${poolAddress}:`, error);
            return null;
        }
    }

    // Get prices from a specific DEX for a token pair
    private async getDexPrices(
        tokenA: string,
        tokenB: string,
        dexName: string
    ): Promise<PoolResult[]> {
        console.log(`[DEBUG] getDexPrices: Starting for ${dexName} with tokenA=${tokenA}, tokenB=${tokenB}`);

        const results: PoolResult[] = [];

        try {
            if (dexName === 'uniswap_v3' || dexName === 'pancakeswap_v3') {
                console.log(`[DEBUG] getDexPrices: Processing V3 DEX ${dexName}`);

                const factoryAddress = dexName === 'uniswap_v3' ? UNISWAP_V3_FACTORY : PANCAKESWAP_V3_FACTORY;
                console.log(`[DEBUG] getDexPrices: Using factory address ${factoryAddress}`);

                const factory = new ethers.Contract(factoryAddress, V3_FACTORY_ABI, this.provider);

                for (const fee of V3_FEE_TIERS) {
                    console.log(`[DEBUG] getDexPrices: Checking ${dexName} pool with fee tier ${fee}`);

                    try {
                        const poolAddress = await factory.getPool(tokenA, tokenB, fee);
                        console.log(`[DEBUG] getDexPrices: Pool address for fee ${fee}: ${poolAddress}`);

                        if (poolAddress !== ethers.ZeroAddress) {
                            console.log(`[DEBUG] getDexPrices: Valid pool found, getting liquidity`);

                            const liquidity = await this.getPoolLiquidity(poolAddress, true);
                            console.log(`[DEBUG] getDexPrices: Pool liquidity: ${liquidity}`);

                            if (liquidity > 0n) {
                                console.log(`[DEBUG] getDexPrices: Getting price from pool`);
                                const priceResult = await this.getTokenPriceFromPool(tokenA, poolAddress);

                                if (priceResult) {
                                    const poolResult = {
                                        dex: dexName,
                                        poolAddress,
                                        liquidity: liquidity.toString(),
                                        priceInWei: priceResult.priceInWei,
                                        baseToken: priceResult.baseToken,
                                        baseTokenSymbol: priceResult.baseTokenSymbol,
                                        fee
                                    };

                                    results.push(poolResult);
                                    console.log(`[DEBUG] getDexPrices: ✅ Added ${dexName} pool with fee ${fee}, price ${priceResult.priceInWei}, liquidity ${liquidity}`);
                                } else {
                                    console.log(`[DEBUG] getDexPrices: ❌ Failed to get price from pool`);
                                }
                            } else {
                                console.log(`[DEBUG] getDexPrices: Pool has zero liquidity, skipping`);
                            }
                        } else {
                            console.log(`[DEBUG] getDexPrices: No pool found for fee tier ${fee}`);
                        }
                    } catch (feeError: any) {
                        console.log(`[DEBUG] getDexPrices: Error with fee tier ${fee}:`, feeError.message);
                        continue;
                    }
                }
            } else {
                console.log(`[DEBUG] getDexPrices: Processing V2 DEX ${dexName}`);

                // V2 style DEXes
                const factoryAddress = {
                    'uniswap_v2': UNISWAP_V2_FACTORY,
                    'sushiswap': SUSHISWAP_FACTORY,
                    'pancakeswap_v2': PANCAKESWAP_V2_FACTORY
                }[dexName];

                if (factoryAddress) {
                    console.log(`[DEBUG] getDexPrices: Using V2 factory address ${factoryAddress}`);

                    const factory = new ethers.Contract(factoryAddress, V2_FACTORY_ABI, this.provider);
                    const pairAddress = await factory.getPair(tokenA, tokenB);

                    console.log(`[DEBUG] getDexPrices: V2 pair address: ${pairAddress}`);

                    if (pairAddress !== ethers.ZeroAddress) {
                        console.log(`[DEBUG] getDexPrices: Valid V2 pair found, getting liquidity`);

                        const liquidity = await this.getPoolLiquidity(pairAddress, false);
                        console.log(`[DEBUG] getDexPrices: V2 pair liquidity: ${liquidity}`);

                        if (liquidity > 0n) {
                            console.log(`[DEBUG] getDexPrices: Getting price from V2 pair`);
                            const priceResult = await this.getTokenPriceFromPool(tokenA, pairAddress);

                            if (priceResult) {
                                const poolResult = {
                                    dex: dexName,
                                    poolAddress: pairAddress,
                                    liquidity: liquidity.toString(),
                                    priceInWei: priceResult.priceInWei,
                                    baseToken: priceResult.baseToken,
                                    baseTokenSymbol: priceResult.baseTokenSymbol
                                };

                                results.push(poolResult);
                                console.log(`[DEBUG] getDexPrices: ✅ Added ${dexName} V2 pair, price ${priceResult.priceInWei}, liquidity ${liquidity}`);
                            } else {
                                console.log(`[DEBUG] getDexPrices: ❌ Failed to get price from V2 pair`);
                            }
                        } else {
                            console.log(`[DEBUG] getDexPrices: V2 pair has zero liquidity, skipping`);
                        }
                    } else {
                        console.log(`[DEBUG] getDexPrices: No V2 pair found`);
                    }
                } else {
                    console.log(`[DEBUG] getDexPrices: ❌ Unknown V2 DEX: ${dexName}`);
                }
            }
        } catch (error: any) {
            console.error(`[DEBUG] getDexPrices: ❌ Error in getDexPrices for ${dexName}:`, error);
        }

        console.log(`[DEBUG] getDexPrices: Completed ${dexName}, returning ${results.length} results`);
        return results;
    }

    // Query Moralis API for pools containing a specific token
    private async queryMoralisForPools(tokenAddress: string): Promise<MoralisPair[]> {
        console.log(`[DEBUG] queryMoralisForPools: Starting API call for token ${tokenAddress}`);

        try {
            // Limit response size and sort by liquidity
            const apiUrl = `${MORALIS_API_BASE}/erc20/${tokenAddress}/pairs?chain=eth&limit=50`;
            console.log(`[DEBUG] queryMoralisForPools: API URL: ${apiUrl}`);

            const response = await fetch(apiUrl, {
                headers: {
                    'X-API-Key': this.moralisApiKey || ''
                }
            });

            console.log(`[DEBUG] queryMoralisForPools: API response status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                console.error(`Moralis API error: ${response.status} ${response.statusText}`);
                return [];
            }

            const data: MoralisResponse = await response.json();
            const allPairs = data.pairs || [];

            console.log(`[DEBUG] queryMoralisForPools: Received ${allPairs.length} pairs from API`);

            // Filter to get only one pair per DEX (the one with highest liquidity)
            const pairsByDex = new Map<string, MoralisPair>();

            for (const pair of allPairs) {
                // Skip pairs with null or undefined exchange_name
                if (!pair.exchange_name) {
                    console.log(`[DEBUG] queryMoralisForPools: Skipping pair ${pair.pair_address} with null/undefined exchange_name`);
                    continue;
                }

                const dexName = pair.exchange_name.toLowerCase();
                const existingPair = pairsByDex.get(dexName);

                console.log(`[DEBUG] queryMoralisForPools: Processing pair ${pair.pair_address} on ${pair.exchange_name} with liquidity $${pair.liquidity_usd}`);

                // Only consider pairs with reasonable liquidity (> $1000)
                if (pair.liquidity_usd < 1000) {
                    console.log(`[DEBUG] queryMoralisForPools: Skipping low liquidity pair ($${pair.liquidity_usd} < $1000)`);
                    continue;
                }

                if (!existingPair || pair.liquidity_usd > existingPair.liquidity_usd) {
                    if (existingPair) {
                        console.log(`[DEBUG] queryMoralisForPools: Replacing ${dexName} pair (old: $${existingPair.liquidity_usd}, new: $${pair.liquidity_usd})`);
                    } else {
                        console.log(`[DEBUG] queryMoralisForPools: Adding new ${dexName} pair with liquidity $${pair.liquidity_usd}`);
                    }
                    pairsByDex.set(dexName, pair);
                } else {
                    console.log(`[DEBUG] queryMoralisForPools: Keeping existing ${dexName} pair (existing: $${existingPair.liquidity_usd} >= new: $${pair.liquidity_usd})`);
                }
            }

            const result = Array.from(pairsByDex.values());
            console.log(`[DEBUG] queryMoralisForPools: Returning ${result.length} filtered pairs:`, result.map(p => ({
                dex: p.exchange_name,
                liquidity: p.liquidity_usd,
                address: p.pair_address
            })));

            return result;
        } catch (error: any) {
            console.error('Error fetching pools from Moralis:', error);
            return [];
        }
    }

    // CORE: Find pools through Moralis and get all available prices (ensuring pools are returned)
    async getAllAvailablePrices(tokenAddress: string): Promise<PoolResult[]> {
        console.log(`[DEBUG] getAllAvailablePrices: Starting for token ${tokenAddress}`);

        let allResults: PoolResult[] = [];

        // First, try Moralis API
        try {
            allResults = await this.getMoralisPools(tokenAddress);
        } catch (error) {
            console.error(`[DEBUG] getAllAvailablePrices: Moralis failed:`, error);
        }

        // If Moralis returns no results, fallback to direct DEX queries
        if (allResults.length === 0) {
            console.log(`[DEBUG] getAllAvailablePrices: Moralis returned no results, trying direct DEX queries...`);
            allResults = await this.getDirectDexPools(tokenAddress);
        }

        console.log(`[DEBUG] getAllAvailablePrices: Final result count: ${allResults.length}`);
        return allResults;
    }

    // Get pools from Moralis API
    private async getMoralisPools(tokenAddress: string): Promise<PoolResult[]> {
        const allResults: PoolResult[] = [];
        const processedPools = new Set<string>();

        // Define supported DEXes
        const supportedDexes = new Set([
            'uniswap v3',
            'uniswap v2',
            'sushiswap v2',
            'pancakeswap v3',
            'pancakeswap v2'
        ]);

        console.log(`[DEBUG] getMoralisPools: Supported DEXes:`, Array.from(supportedDexes));

        console.log(`[Moralis] Fetching pools for token: ${tokenAddress}`);
        const allPools = await this.queryMoralisForPools(tokenAddress);

        console.log(`[DEBUG] getMoralisPools: Received ${allPools.length} pools from Moralis`);

        if (allPools.length === 0) {
            console.log(`[DEBUG] getMoralisPools: No pools returned from Moralis API`);
            return [];
        }

        // Filter to only supported DEXes
        const supportedPools = allPools.filter(pool => {
            if (!pool.exchange_name) return false;

            const exchangeName = pool.exchange_name.toLowerCase();

            // Check for supported DEX patterns
            const isSupported = (
                (exchangeName.includes('uniswap') && exchangeName.includes('v3')) ||
                (exchangeName.includes('uniswap') && exchangeName.includes('v2')) ||
                (exchangeName.includes('sushiswap')) ||
                (exchangeName.includes('pancakeswap') && exchangeName.includes('v3')) ||
                (exchangeName.includes('pancakeswap') && exchangeName.includes('v2'))
            );

            console.log(`[DEBUG] getMoralisPools: Pool ${pool.pair_address} on ${pool.exchange_name} - supported: ${isSupported}`);
            return isSupported;
        });

        console.log(`[Moralis] Processing ${supportedPools.length} supported pools for ${tokenAddress}`);

        // Process all supported pools (prioritize WETH pairs but include others)
        for (const pool of supportedPools.slice(0, 10)) { // Process up to 10 pools
            console.log(`[DEBUG] getMoralisPools: Processing pool ${pool.pair_address} on ${pool.exchange_name} with liquidity $${pool.liquidity_usd}`);

            const poolKey = pool.pair_address;
            if (processedPools.has(poolKey)) {
                console.log(`[DEBUG] getMoralisPools: Pool ${poolKey} already processed, skipping`);
                continue;
            }
            processedPools.add(poolKey);

            // Determine which token is the "other" token (not our target)
            const token0 = pool.pair.find(t => t.pair_token_type === "token0");
            const token1 = pool.pair.find(t => t.pair_token_type === "token1");

            if (!token0 || !token1) {
                console.log(`[DEBUG] getMoralisPools: Pool ${poolKey} missing token data, skipping`);
                continue;
            }

            console.log(`[DEBUG] getMoralisPools: Pool tokens - token0: ${token0.token_address} (${token0.token_symbol}), token1: ${token1.token_address} (${token1.token_symbol})`);

            const isTargetBaseToken = token0.token_address.toLowerCase() === tokenAddress.toLowerCase();
            const otherTokenAddress = isTargetBaseToken ? token1.token_address : token0.token_address;
            const otherTokenSymbol = isTargetBaseToken ? token1.token_symbol : token0.token_symbol;

            console.log(`[DEBUG] getMoralisPools: Target token is ${isTargetBaseToken ? 'token0' : 'token1'}, paired with ${otherTokenSymbol}`);

            // Check if this is a WETH pair (preferred for ETH wei pricing)
            const isWETHPair = otherTokenAddress.toLowerCase() === WETH_ADDRESS.toLowerCase();
            console.log(`[DEBUG] getMoralisPools: Is WETH pair: ${isWETHPair}`);

            // Get on-chain price data
            console.log(`[Moralis] Getting price for pool ${pool.pair_address} on ${pool.exchange_name}`);
            const priceResult = await this.getTokenPriceFromPool(tokenAddress, pool.pair_address);

            if (priceResult) {
                const mappedDexId = mapMoralisDexId(pool.exchange_name);
                console.log(`[DEBUG] getMoralisPools: Mapped ${pool.exchange_name} to ${mappedDexId}`);

                const poolResult = {
                    dex: mappedDexId,
                    poolAddress: pool.pair_address,
                    liquidity: pool.liquidity_usd?.toString() || '0',
                    priceInWei: priceResult.priceInWei,
                    baseToken: otherTokenAddress,
                    baseTokenSymbol: otherTokenSymbol,
                    fee: undefined
                };

                allResults.push(poolResult);
                console.log(`[Moralis] ✅ Added ${mappedDexId} pool with liquidity ${pool.liquidity_usd} (base: ${otherTokenSymbol}${isWETHPair ? ' - ETH WEI' : ''})`);
            } else {
                console.log(`[Moralis] ❌ Failed to get price for pool ${pool.pair_address}`);
            }
        }

        return this.deduplicateAndSort(allResults);
    }

    // Get pools by directly querying DEX factories (fallback)
    private async getDirectDexPools(tokenAddress: string): Promise<PoolResult[]> {
        console.log(`[DEBUG] getDirectDexPools: Starting direct DEX queries for ${tokenAddress}`);

        const allResults: PoolResult[] = [];

        // Common base tokens to pair with
        const baseTokens = [
            { address: WETH_ADDRESS, symbol: 'WETH' },
            { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' },
            { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI' },
            { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT' }
        ];

        // Try each major DEX with each base token
        const dexesToTry = ['uniswap_v3', 'uniswap_v2', 'sushiswap'];

        for (const dexName of dexesToTry) {
            for (const baseToken of baseTokens) {
                try {
                    console.log(`[DEBUG] getDirectDexPools: Trying ${dexName} with ${tokenAddress}/${baseToken.symbol}`);

                    const dexPrices = await this.getDexPrices(tokenAddress, baseToken.address, dexName);

                    if (dexPrices.length > 0) {
                        allResults.push(...dexPrices);
                        console.log(`[DEBUG] getDirectDexPools: ✅ Found ${dexPrices.length} pools on ${dexName} with ${baseToken.symbol}`);
                    } else {
                        console.log(`[DEBUG] getDirectDexPools: ❌ No pools found on ${dexName} with ${baseToken.symbol}`);
                    }
                } catch (error) {
                    console.log(`[DEBUG] getDirectDexPools: Error querying ${dexName} with ${baseToken.symbol}:`, error);
                    continue;
                }
            }
        }

        console.log(`[DEBUG] getDirectDexPools: Found ${allResults.length} pools via direct queries`);
        return this.deduplicateAndSort(allResults);
    }

    // Helper to deduplicate and sort results
    private deduplicateAndSort(allResults: PoolResult[]): PoolResult[] {
        console.log(`[DEBUG] deduplicateAndSort: Processing ${allResults.length} results`);

        // Remove duplicates and sort by liquidity (prioritize WETH pairs)
        const uniqueResults = allResults.reduce((acc: PoolResult[], current) => {
            const existing = acc.find(r => r.poolAddress === current.poolAddress);
            if (!existing) {
                acc.push(current);
                console.log(`[DEBUG] deduplicateAndSort: Added unique pool ${current.poolAddress} (${current.dex})`);
            } else if (parseFloat(current.liquidity) > parseFloat(existing.liquidity)) {
                const index = acc.indexOf(existing);
                acc[index] = current;
                console.log(`[DEBUG] deduplicateAndSort: Replaced pool ${current.poolAddress} with higher liquidity`);
            } else {
                console.log(`[DEBUG] deduplicateAndSort: Skipped duplicate pool ${current.poolAddress} with lower liquidity`);
            }
            return acc;
        }, []);

        const finalResults = uniqueResults
            .filter(r => {
                const isValid = r.priceInWei !== "0";
                console.log(`[DEBUG] deduplicateAndSort: Pool ${r.poolAddress} price ${r.priceInWei} (${r.baseTokenSymbol}) - valid: ${isValid}`);
                return isValid;
            })
            .sort((a, b) => {
                // Sort by WETH pairs first, then by liquidity
                const aIsWETH = a.baseTokenSymbol === 'WETH';
                const bIsWETH = b.baseTokenSymbol === 'WETH';

                if (aIsWETH && !bIsWETH) return -1; // a comes first
                if (!aIsWETH && bIsWETH) return 1;  // b comes first

                // Both same type, sort by liquidity
                const sortResult = parseFloat(b.liquidity) - parseFloat(a.liquidity);
                console.log(`[DEBUG] deduplicateAndSort: Sorting ${a.dex}(${a.liquidity}) vs ${b.dex}(${b.liquidity}) = ${sortResult}`);
                return sortResult;
            });

        console.log(`[DEBUG] deduplicateAndSort: Final results: ${finalResults.length} pools with prices`);
        console.log(`[DEBUG] deduplicateAndSort: Final results summary:`, finalResults.map(r => ({
            dex: r.dex,
            priceInWei: r.priceInWei,
            liquidity: r.liquidity,
            baseToken: r.baseTokenSymbol,
            isETHWei: r.baseTokenSymbol === 'WETH'
        })));

        return finalResults;
    }

    // CORE: Get the best price (highest liquidity) for a specific token pair
    async getTokenPriceWithBestLiquidity(tokenA: string, tokenB: string): Promise<PoolResult | null> {
        // Prioritize DEXes by importance and liquidity
        const prioritizedDexes = ['uniswap_v3', 'uniswap_v2', 'sushiswap'];
        const allPrices: PoolResult[] = [];

        for (const dexName of prioritizedDexes) {
            try {
                const prices = await this.getDexPrices(tokenA, tokenB, dexName);
                if (prices.length > 0) {
                    // Take the best pool from this DEX
                    const bestFromDex = prices.reduce((best, current) =>
                        parseFloat(current.liquidity) > parseFloat(best.liquidity) ? current : best
                    );
                    allPrices.push(bestFromDex);
                }
            } catch (error) {
                console.error(`Error getting prices from ${dexName}:`, error);
                continue;
            }
        }

        if (allPrices.length === 0) {
            return null;
        }

        // Return the pool with highest liquidity across all DEXes
        return allPrices.reduce((best, current) =>
            parseFloat(current.liquidity) > parseFloat(best.liquidity) ? current : best
        );
    }

    // CORE: Get the absolute best price across ALL possible pools
    async getAbsoluteBestPrice(tokenAddress: string): Promise<PoolResult | null> {
        try {
            const allPrices = await this.getAllAvailablePrices(tokenAddress);
            return allPrices.length > 0 ? allPrices[0] : null; // Already sorted by liquidity
        } catch {
            return null;
        }
    }

    // NEW: Get token price specifically in ETH wei (ensures consistent pricing)
    async getTokenPriceInETHWei(tokenAddress: string): Promise<PoolResult | null> {
        console.log(`[DEBUG] getTokenPriceInETHWei: Starting for token ${tokenAddress}`);

        // If token is already WETH, return 1 ETH (1e18 wei)
        if (tokenAddress.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
            console.log(`[DEBUG] getTokenPriceInETHWei: Token is WETH, returning 1 ETH`);
            return {
                dex: 'native',
                poolAddress: WETH_ADDRESS,
                liquidity: '0',
                priceInWei: '1000000000000000000', // 1 ETH in wei
                baseToken: WETH_ADDRESS,
                baseTokenSymbol: 'WETH',
                fee: 0
            };
        }

        // Try to find the best WETH pair across all DEXes
        console.log(`[DEBUG] getTokenPriceInETHWei: Looking for WETH pairs for ${tokenAddress}`);
        const wethPriceResult = await this.getTokenPriceWithBestLiquidity(tokenAddress, WETH_ADDRESS);

        if (wethPriceResult) {
            console.log(`[DEBUG] getTokenPriceInETHWei: ✅ Found direct WETH pair - Price: ${wethPriceResult.priceInWei} ETH wei`);
            return wethPriceResult;
        }

        // If no direct WETH pair found, look through Moralis data for WETH pairs
        console.log(`[DEBUG] getTokenPriceInETHWei: No direct WETH pair found, checking Moralis data...`);
        const allPools = await this.queryMoralisForPools(tokenAddress);

        // Filter for WETH pairs only
        const wethPools = allPools.filter(pool => {
            const hasWETH = pool.pair.some(token =>
                token.token_address.toLowerCase() === WETH_ADDRESS.toLowerCase()
            );
            console.log(`[DEBUG] getTokenPriceInETHWei: Pool ${pool.pair_address} has WETH: ${hasWETH}`);
            return hasWETH;
        });

        if (wethPools.length === 0) {
            console.log(`[DEBUG] getTokenPriceInETHWei: ❌ No WETH pairs found for ${tokenAddress}`);
            return null;
        }

        // Get the best WETH pool (highest liquidity)
        const bestWethPool = wethPools.reduce((best, current) =>
            current.liquidity_usd > best.liquidity_usd ? current : best
        );

        console.log(`[DEBUG] getTokenPriceInETHWei: Best WETH pool found with liquidity $${bestWethPool.liquidity_usd}`);

        // Get price from the best WETH pool
        const priceResult = await this.getTokenPriceFromPool(tokenAddress, bestWethPool.pair_address);

        if (priceResult && priceResult.baseTokenSymbol === 'WETH') {
            const mappedDexId = mapMoralisDexId(bestWethPool.exchange_name);

            const result: PoolResult = {
                dex: mappedDexId,
                poolAddress: bestWethPool.pair_address,
                liquidity: bestWethPool.liquidity_usd.toString(),
                priceInWei: priceResult.priceInWei, // Already in ETH wei since base is WETH
                baseToken: WETH_ADDRESS,
                baseTokenSymbol: 'WETH',
                fee: undefined
            };

            console.log(`[DEBUG] getTokenPriceInETHWei: ✅ Success - Price: ${result.priceInWei} ETH wei`);
            return result;
        }

        console.log(`[DEBUG] getTokenPriceInETHWei: ❌ Failed to get price from WETH pool`);
        return null;
    }
}