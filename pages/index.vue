<template>
    <div class="h-full flex justify-center items-center -mt-10">
        <div class="max-w-5xl w-full relative z-10">
            <!-- Error Display -->
            <div v-if="error" class="bg-red-500 text-white p-4 rounded-lg mb-6 text-center">
                {{ error }}
            </div>

            <!-- Price Table -->
            <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div class="bg-gray-900 px-6 py-4 border-b border-gray-800">
                    <h2 class="text-xl font-bold text-white">Token Prices Across DEXes</h2>
                    <p class="text-sm text-gray-400 mt-1">Real-time prices from Uniswap, SushiSwap, and PancakeSwap</p>
                </div>

                <div v-if="tokenPrices.length === 0" class="p-8 text-center text-gray-400">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    Loading token prices...
                </div>

                <div v-else class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-900">
                            <tr>
                                <th
                                    class="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider border-b border-gray-800"
                                >
                                    Token
                                </th>
                                <th
                                    class="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider border-b border-gray-800"
                                >
                                    Uniswap V3
                                </th>
                                <th
                                    class="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider border-b border-gray-800"
                                >
                                    Uniswap V2
                                </th>
                                <th
                                    class="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider border-b border-gray-800"
                                >
                                    SushiSwap
                                </th>
                            </tr>
                        </thead>
                        <tbody class="bg-gray-900 divide-y divide-gray-800">
                            <tr v-for="token in tokenPrices" :key="token.symbol" class="hover:bg-gray-800">
                                <!-- Token Info -->
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <div class="flex items-center">
                                        <div class="text-sm font-medium text-white">{{ token.symbol }}</div>
                                        <div class="text-xs text-gray-500 ml-2">{{ formatAddress(token.address) }}</div>
                                    </div>
                                </td>

                                <!-- Uniswap V3 -->
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <div v-if="getV3Price(token)" class="text-sm">
                                        <div class="font-mono text-white font-semibold text-center">
                                            ${{ formatPrice(getV3Price(token)!.priceInWei, token.decimals) }}
                                        </div>
                                    </div>
                                    <div v-else class="text-xs text-gray-600 text-center">N/A</div>
                                </td>

                                <!-- Uniswap V2 -->
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <div v-if="getV2Price(token)" class="text-sm">
                                        <div class="font-mono text-white font-semibold text-center">
                                            ${{ formatPrice(getV2Price(token)!.priceInWei, token.decimals) }}
                                        </div>
                                    </div>
                                    <div v-else class="text-xs text-gray-600 text-center">N/A</div>
                                </td>

                                <!-- SushiSwap -->
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <div v-if="getSushiPrice(token)" class="text-sm">
                                        <div class="font-mono text-white font-semibold text-center">
                                            ${{ formatPrice(getSushiPrice(token)!.priceInWei, token.decimals) }}
                                        </div>
                                    </div>
                                    <div v-else class="text-xs text-gray-600 text-center">N/A</div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { PriceService } from '~/lib/priceUtils'
import { ethers } from 'ethers'

interface DexPriceInfo {
    priceInWei: string
    poolAddress: string
    liquidity: string
    fee?: number
    error?: string
    lastUpdate: number
}

interface TokenInfo {
    symbol: string
    address: string
    decimals: number
    name?: string
    dexPrices: {
        [dexName: string]: DexPriceInfo
    }
    lastUpdate: number
}

interface WebSocketMessage {
    type: 'tokens' | 'ping' | 'pong' | 'error' | 'subscribe' | 'unsubscribe'
    data?: TokenInfo[]
    message?: string
    timestamp?: number
    clientId?: string
    isWelcome?: boolean
}

// Reactive state
const connectionStatus = ref('Connecting...')
const tokenPrices = ref<TokenInfo[]>([])
const error = ref('')
const lastUpdate = ref(0)

let ws: WebSocket | null = null

const rpcUrl = useRuntimeConfig().rpcUrl
const thegraphApiKey = useRuntimeConfig().thegraphApiKey
const priceService = new PriceService(new ethers.JsonRpcProvider(rpcUrl), thegraphApiKey as string)

const tokenAllPrices = computed(async () => {
    const prices = await priceService.getAllAvailablePrices('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')
    return prices
})

// Computed properties
const connectionStatusClass = computed(() => {
    switch (connectionStatus.value) {
        case 'Connected':
            return 'bg-green-500 text-white'
        case 'Disconnected':
            return 'bg-red-500 text-white'
        default:
            return 'bg-yellow-500 text-white'
    }
})

const connectionDotClass = computed(() => {
    switch (connectionStatus.value) {
        case 'Connected':
            return 'bg-white'
        case 'Disconnected':
            return 'bg-white'
        default:
            return 'bg-white animate-pulse'
    }
})

const totalPricePoints = computed(() => {
    return tokenPrices.value.reduce((total, token) => {
        return total + Object.keys(token.dexPrices).length
    }, 0)
})

const avgSpread = computed(() => {
    const spreads = tokenPrices.value.map(token => getSpread(token)).filter(spread => spread !== null) as number[]

    if (spreads.length === 0) return '0.00'

    const avg = spreads.reduce((sum, spread) => sum + spread, 0) / spreads.length
    return avg.toFixed(2)
})

const lastUpdateTime = computed(() => {
    if (lastUpdate.value === 0) return '--:--'
    return formatTime(lastUpdate.value)
})

// Helper functions
function formatAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatPrice(priceWei: string, decimals: number = 6): string {
    const price = BigInt(priceWei)
    console.log('price', price)
    if (price === 0n) return '0.000000'

    const divisor = 10 ** decimals
    const formattedPrice = Number(price) / divisor

    if (formattedPrice > 1000) {
        return formattedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } else if (formattedPrice > 1) {
        return formattedPrice.toFixed(4)
    } else {
        return formattedPrice.toFixed(6)
    }
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString()
}

function getV3Price(token: TokenInfo): DexPriceInfo | null {
    return token.dexPrices['uniswap_v3'] && !token.dexPrices['uniswap_v3'].error ? token.dexPrices['uniswap_v3'] : null
}

function getV2Price(token: TokenInfo): DexPriceInfo | null {
    return token.dexPrices['uniswap_v2'] && !token.dexPrices['uniswap_v2'].error ? token.dexPrices['uniswap_v2'] : null
}

function getSushiPrice(token: TokenInfo): DexPriceInfo | null {
    return token.dexPrices['sushiswap'] && !token.dexPrices['sushiswap'].error ? token.dexPrices['sushiswap'] : null
}

function getBestPrice(token: TokenInfo): { price: string; dex: string } | null {
    const validPrices = Object.entries(token.dexPrices)
        .filter(([_, priceInfo]) => !priceInfo.error && priceInfo.priceInWei !== '0')
        .map(([dex, priceInfo]) => ({
            dex,
            price: priceInfo.priceInWei,
            numPrice: Number(priceInfo.priceInWei)
        }))

    if (validPrices.length === 0) return null

    const best = validPrices.reduce((max, current) => (current.numPrice > max.numPrice ? current : max))

    return { price: best.price, dex: best.dex }
}

function getSpread(token: TokenInfo): number | null {
    const validPrices = Object.entries(token.dexPrices)
        .filter(([_, priceInfo]) => !priceInfo.error && priceInfo.priceInWei !== '0')
        .map(([_, priceInfo]) => Number(priceInfo.priceInWei))

    if (validPrices.length < 2) return null

    const max = Math.max(...validPrices)
    const min = Math.min(...validPrices)

    return ((max - min) / min) * 100
}

function getSpreadColor(spread: number): string {
    if (spread > 2) return 'text-red-600'
    if (spread > 1) return 'text-yellow-600'
    return 'text-green-600'
}

function connectWebSocket() {
    try {
        // Connect to Nuxt API WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}/api/priceFeed`

        console.log('Connecting to WebSocket at:', wsUrl)
        ws = new WebSocket(wsUrl)

        ws.onopen = () => {
            console.log('Connected to WebSocket')
            connectionStatus.value = 'Connected'
            error.value = ''
        }

        ws.onmessage = event => {
            try {
                const message: WebSocketMessage = JSON.parse(event.data)
                handleMessage(message)
            } catch (err) {
                console.error('Error parsing message:', err)
            }
        }

        ws.onclose = () => {
            connectionStatus.value = 'Disconnected'
            setTimeout(() => {
                console.log('Attempting to reconnect...')
                connectWebSocket()
            }, 5000)
        }

        ws.onerror = err => {
            console.error('WebSocket error:', err)
            error.value = 'Connection failed. Retrying...'
        }
    } catch (err) {
        console.error('Failed to connect:', err)
        error.value = 'Failed to establish WebSocket connection'
    }
}

function handleMessage(message: WebSocketMessage) {
    switch (message.type) {
        case 'tokens':
            if (message.data) {
                tokenPrices.value = message.data
                lastUpdate.value = Date.now()

                if (message.isWelcome) {
                    console.log('Connected! Received initial tokens:', message.data.length)
                } else {
                    console.log('Price update received:', message.data.length, 'tokens')
                }
            }
            break

        case 'error':
            console.error('WebSocket error:', message.message)
            error.value = message.message || 'Unknown error occurred'
            break

        case 'pong':
            // Connection keep-alive response
            break

        default:
            console.log('Received message:', message.type)
    }
}

// Lifecycle
onMounted(() => {
    connectWebSocket()

    // Keep connection alive
    setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
        }
    }, 30000)
})

onUnmounted(() => {
    if (ws) {
        ws.close()
    }
})
</script>
