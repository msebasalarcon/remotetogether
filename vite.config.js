import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: [
      '@tensorflow/tfjs',
      '@tensorflow/tfjs-core',
      '@tensorflow/tfjs-backend-webgl',
      '@tensorflow/tfjs-converter',
      '@tensorflow-models/body-pix'
    ]
  },
  server: {
    host: true, // 👈 This makes your dev server accessible via local network
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://*.mediapipe.dev; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://storage.googleapis.com https://*.storage.googleapis.com https://*.mediapipe.dev; media-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net https://*.peerjs.com wss://*.peerjs.com https://stun.l.google.com https://global.stun.twilio.com ws://localhost:* wss://localhost:* https://storage.googleapis.com/tfjs-models/ https://tfjs-models.storage.googleapis.com https://*.mediapipe.dev;"
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          tensorflow: ['@tensorflow/tfjs'],
          bodypix: ['@tensorflow-models/body-pix']
        }
      }
    }
  }
})
