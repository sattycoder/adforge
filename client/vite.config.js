import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Allow external connections
    allowedHosts: [
      'localhost',
    ],
    proxy: {
      '/api': {
        target: (() => {
          const url = process.env.VITE_BACKEND_URL
          if (!url) {
            throw new Error('VITE_BACKEND_URL is not set. Please define it in client/.env')
          }
          return url
        })(),
        changeOrigin: true,
      },
      // Proxy static assets served by Express in dev so image URLs work
      '/screenshots': {
        target: (() => {
          const url = process.env.VITE_BACKEND_URL
          if (!url) {
            throw new Error('VITE_BACKEND_URL is not set. Please define it in client/.env')
          }
          return url
        })(),
        changeOrigin: true,
      },
      '/uploads': {
        target: (() => {
          const url = process.env.VITE_BACKEND_URL
          if (!url) {
            throw new Error('VITE_BACKEND_URL is not set. Please define it in client/.env')
          }
          return url
        })(),
        changeOrigin: true,
      },
    },
  },
})
