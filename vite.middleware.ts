import { Connect } from 'vite';
import { lookup } from 'mime-types';

export function wasmMiddleware(): Connect.NextHandleFunction {
  return function (req, res, next) {
    const url = req.url;
    if (url && url.endsWith('.wasm')) {
      const mimeType = lookup('.wasm');
      if (mimeType) {
        res.setHeader('Content-Type', mimeType);
      }
    }
    next();
  };
} 