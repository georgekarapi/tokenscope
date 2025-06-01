import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: true },
  modules: ['@nuxt/icon', '@nuxt/image', 'shadcn-nuxt'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [
      tailwindcss(),
    ],
  },
  nitro: {
    routeRules: {
      '/.well-known/appspecific/**': {
        headers: { 'cache-control': 'max-age=31536000' },
        redirect: { to: '/', statusCode: 404 }
      },
    },
    experimental: {
      websocket: true
    }
  },
  runtimeConfig: {
    rpcUrl: '',
    thegraphApiKey: '',
    moralisApiKey: ''
  },
  imports: {
    dirs: [
      '@/interfaces/*.d.ts',
      '@/types/*.d.ts',
      '@/components/ui/**'
    ]
  },
})