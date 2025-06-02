import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { wasmMiddleware } from './vite.middleware';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'onnxruntime-web/dist'
        }
      ]
    }),
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use(wasmMiddleware());
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          next();
        });
      },
      configurePreviewServer: (server) => {
        server.middlewares.use(wasmMiddleware());
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          next();
        });
      }
    }
  ],
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'onnxruntime-web': ['onnxruntime-web']
        }
      }
    }
  },
  publicDir: 'public'
}); 