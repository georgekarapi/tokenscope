import { WebSocket } from 'ws'

interface WebSocketMessage {
    type: 'tokens' | 'ping' | 'pong' | 'error' | 'subscribe' | 'unsubscribe';
    data?: any;
    message?: string;
    timestamp?: number;
}

interface Connection {
    peer: any;
    durableObjectWs?: WebSocket;
}

// Store connections
const connections = new Map<string, Connection>()

// Configuration
const isDevelopment = process.env.NODE_ENV === 'development'
const durableObjectUrl = isDevelopment
    ? 'ws://localhost:8787' // Local Durable Object during development
    : 'wss://tokenscope-durable-object.YOUR_SUBDOMAIN.workers.dev' // Production Durable Object Worker

// Create connection to Durable Object
async function createDurableObjectConnection(connectionId: string): Promise<WebSocket | null> {
    try {
        const ws = new WebSocket(durableObjectUrl)

        return new Promise((resolve, reject) => {
            ws.onopen = () => {
                console.log(`Durable Object connection established: ${connectionId}`)
                resolve(ws)
            }

            ws.onerror = (error) => {
                console.error('Failed to connect to Durable Object:', error)
                reject(null)
            }

            ws.onmessage = (event) => {
                // Forward messages from Durable Object to client
                const connection = connections.get(connectionId)
                if (connection) {
                    connection.peer.send(event.data)
                }
            }

            ws.onclose = () => {
                console.log(`Durable Object connection closed: ${connectionId}`)
                // Clean up connection
                const connection = connections.get(connectionId)
                if (connection) {
                    connection.durableObjectWs = undefined
                }
            }
        })
    } catch (error) {
        console.error('Error creating Durable Object connection:', error)
        return null
    }
}

export default defineWebSocketHandler({
    async open(peer) {
        const connectionId = Math.random().toString(36).substring(7)
        console.log(`New client connected: ${connectionId}`)

        // Store connection
        const connection: Connection = {
            peer
        }
        connections.set(connectionId, connection)

        // Create Durable Object connection
        try {
            const durableObjectWs = await createDurableObjectConnection(connectionId)
            if (durableObjectWs) {
                connection.durableObjectWs = durableObjectWs
                console.log(`Connected to Durable Object for client: ${connectionId}`)
            } else {
                peer.send(JSON.stringify({
                    type: 'error',
                    message: 'Failed to connect to price feed service',
                    timestamp: Date.now()
                }))
            }
        } catch (error) {
            console.error('Error connecting to Durable Object:', error)
            peer.send(JSON.stringify({
                type: 'error',
                message: 'Service unavailable',
                timestamp: Date.now()
            }))
        }

        // Store connection ID for later reference
        ; (peer as any).connectionId = connectionId
    },

    async message(peer, message) {
        try {
            const data: WebSocketMessage = JSON.parse(message.text())
            const connectionId = (peer as any).connectionId
            const connection = connections.get(connectionId)

            if (!connection) {
                peer.send(JSON.stringify({
                    type: 'error',
                    message: 'Connection not found',
                    timestamp: Date.now()
                }))
                return
            }

            // Forward message to Durable Object
            if (connection.durableObjectWs && connection.durableObjectWs.readyState === WebSocket.OPEN) {
                connection.durableObjectWs.send(JSON.stringify(data))
            } else {
                peer.send(JSON.stringify({
                    type: 'error',
                    message: 'Price feed service not available',
                    timestamp: Date.now()
                }))
            }

        } catch (error) {
            console.error('Error handling WebSocket message:', error)
            peer.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format',
                timestamp: Date.now()
            }))
        }
    },

    close(peer) {
        const connectionId = (peer as any).connectionId
        console.log(`Client disconnected: ${connectionId}`)

        const connection = connections.get(connectionId)
        if (connection) {
            // Close Durable Object connection
            if (connection.durableObjectWs) {
                connection.durableObjectWs.close()
            }
            // Remove from connections map
            connections.delete(connectionId)
        }
    },

    error(peer, error) {
        const connectionId = (peer as any).connectionId
        console.error(`WebSocket error for ${connectionId}:`, error)

        const connection = connections.get(connectionId)
        if (connection) {
            if (connection.durableObjectWs) {
                connection.durableObjectWs.close()
            }
            connections.delete(connectionId)
        }
    }
}) 