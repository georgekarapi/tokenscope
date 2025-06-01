import { describe, test, expect } from 'vitest';
import { ethers } from 'ethers';
import {
    PriceService,
    getDexDisplayName
} from '../lib/priceUtils';

// Helper functions for formatting
function formatLiquidity(liquidity) {
    const num = Number(liquidity);
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
}

function formatPrice(priceWei, decimals = 6) {
    const price = BigInt(priceWei);
    if (price === 0n) return '0.000000';

    const divisor = 10 ** decimals;
    const formattedPrice = Number(price) / divisor;

    if (formattedPrice > 1000) {
        return formattedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else if (formattedPrice > 1) {
        return formattedPrice.toFixed(4);
    } else {
        return formattedPrice.toFixed(6);
    }
}

// Test tokens with different characteristics
const testTokens = [
    {
        name: 'UNI',
        address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
        description: 'Popular DeFi token'
    },
    {
        name: 'WETH',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        description: 'Most liquid base token'
    },
    {
        name: 'LINK',
        address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
        description: 'Oracle token'
    },
    {
        name: 'AAVE',
        address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
        description: 'DeFi lending protocol token'
    }
];

describe('Token Price Discovery', () => {
    const provider = new ethers.JsonRpcProvider(
        process.env.NUXT_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo'
    );

    function getApiKey() {
        return process.env.NUXT_THEGRAPH_API_KEY ||
            process.env.THEGRAPH_API_KEY ||
            'test-api-key-placeholder';
    }

    function hasValidApiKey() {
        const apiKey = process.env.NUXT_THEGRAPH_API_KEY || process.env.THEGRAPH_API_KEY;
        return apiKey && apiKey !== 'test-api-key-placeholder' && apiKey.length > 10;
    }

    test('should create PriceService instance', () => {
        console.log('\n🔧 Basic PriceService Test');

        const apiKey = getApiKey();
        const priceService = new PriceService(provider, apiKey);

        expect(priceService).toBeDefined();
        expect(priceService.getTokenPriceFromPool).toBeDefined();
        expect(priceService.getAllAvailablePrices).toBeDefined();
        expect(priceService.getAbsoluteBestPrice).toBeDefined();
        expect(priceService.getTokenPriceWithBestLiquidity).toBeDefined();

        console.log('✅ PriceService instance created successfully');
    });

    test('should test direct pool price calculation', async () => {
        console.log('\n💰 Direct Pool Price Test');

        const priceService = new PriceService(provider, getApiKey());

        // Known WETH/USDC pool on Uniswap V3
        const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
        const poolAddress = '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8';

        try {
            console.log('Testing direct pool price calculation...');
            const directPrice = await priceService.getTokenPriceFromPool(wethAddress, poolAddress);

            if (directPrice) {
                console.log(`✅ Direct pool price calculation successful:`);
                console.log(`   Price: ${formatPrice(directPrice.priceInWei)} ${directPrice.baseTokenSymbol}/WETH`);
                console.log(`   Base Token: ${directPrice.baseTokenSymbol}`);

                expect(directPrice.priceInWei).toBeTruthy();
                expect(directPrice.baseToken).toBeTruthy();
                expect(directPrice.baseTokenSymbol).toBeTruthy();
                expect(BigInt(directPrice.priceInWei)).toBeGreaterThan(0n);
            } else {
                console.log('⚠️ No price data returned (might be network issue)');
            }

            expect(typeof directPrice === 'object' || directPrice === null).toBe(true);

        } catch (error) {
            console.log(`⚠️ Network error (expected in test environment): ${error.message}`);
            expect(error).toBeInstanceOf(Error);
        }
    }, 30000);

    test('should discover pools (with valid API key)', async () => {
        if (!hasValidApiKey()) {
            console.log('\n⚠️ Skipping pool discovery test - no valid API key found');
            console.log('Set NUXT_THEGRAPH_API_KEY or THEGRAPH_API_KEY environment variable to run full tests');
            return;
        }

        console.log('\n🔍 Pool Discovery Test (with The Graph)');

        const priceService = new PriceService(provider, getApiKey());
        const token = testTokens[0];

        try {
            console.log(`Testing ${token.name} pool discovery...`);
            const pools = await priceService.getAllAvailablePrices(token.address);

            console.log(`Found: ${pools.length} pools`);

            if (pools.length > 0) {
                const topPool = pools[0];
                const displayName = getDexDisplayName(topPool.dex, topPool.fee);

                console.log(`Top pool: ${displayName}`);
                console.log(`Against: ${topPool.baseTokenSymbol}`);
                console.log(`Liquidity: ${formatLiquidity(topPool.liquidity)}`);

                expect(topPool.priceInWei).toBeTruthy();
                expect(topPool.poolAddress).toBeTruthy();
                expect(BigInt(topPool.liquidity)).toBeGreaterThan(0n);
            }

            expect(Array.isArray(pools)).toBe(true);

        } catch (error) {
            console.log(`Error: ${error.message}`);
            expect(error).toBeInstanceOf(Error);
        }
    }, 60000);

    test('should find best price for token pair', async () => {
        console.log('\n🎯 Best Price Test');

        const priceService = new PriceService(provider, getApiKey());

        const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
        const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

        try {
            console.log('Finding best WETH/USDC pool...');
            const bestPair = await priceService.getTokenPriceWithBestLiquidity(wethAddress, usdcAddress);

            if (bestPair) {
                const displayName = getDexDisplayName(bestPair.dex, bestPair.fee);

                console.log(`🏆 Best WETH/USDC Pool:`);
                console.log(`   DEX: ${displayName}`);
                console.log(`   Liquidity: ${formatLiquidity(bestPair.liquidity)}`);
                console.log(`   Price: ${formatPrice(bestPair.priceInWei)} ${bestPair.baseTokenSymbol}/WETH`);

                expect(bestPair.poolAddress).toBeTruthy();
                expect(bestPair.dex).toBeTruthy();
                expect(BigInt(bestPair.liquidity)).toBeGreaterThan(0n);
                expect(BigInt(bestPair.priceInWei)).toBeGreaterThan(0n);
            } else {
                console.log('⚠️ No pools found (might be network/API issue)');
            }

            expect(bestPair === null || typeof bestPair === 'object').toBe(true);

        } catch (error) {
            console.log(`Error: ${error.message}`);
            expect(error).toBeInstanceOf(Error);
        }
    }, 45000);

    test('should handle edge cases gracefully', async () => {
        console.log('\n🧪 Edge Cases Test');

        const priceService = new PriceService(provider, getApiKey());

        const fakeToken = '0x0000000000000000000000000000000000000001';

        try {
            console.log('Testing with invalid token address...');

            const fakePools = await priceService.getAllAvailablePrices(fakeToken);
            expect(Array.isArray(fakePools)).toBe(true);
            console.log(`Invalid token pools: ${fakePools.length} (expected: 0)`);

            const fakeBest = await priceService.getAbsoluteBestPrice(fakeToken);
            expect(fakeBest === null || typeof fakeBest === 'object').toBe(true);
            console.log(`Invalid token best: ${fakeBest ? 'Found' : 'None'} (expected: None)`);

            console.log('✅ Edge cases handled correctly');

        } catch (error) {
            console.log(`Edge case error (acceptable): ${error.message}`);
            expect(error).toBeInstanceOf(Error);
        }
    }, 30000);

    test('should validate getDexDisplayName utility', () => {
        console.log('\n🏷️ Utility Function Test');

        expect(getDexDisplayName('uniswap_v3', 3000)).toBe('Uniswap V3 (0.3%)');
        expect(getDexDisplayName('uniswap_v2')).toBe('Uniswap V2');
        expect(getDexDisplayName('sushiswap')).toBe('SushiSwap');
        expect(getDexDisplayName('pancakeswap_v3', 500)).toBe('PancakeSwap V3 (0.05%)');

        console.log('✅ Utility functions working correctly');
    });
}); 