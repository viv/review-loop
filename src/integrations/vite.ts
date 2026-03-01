import type { Plugin, ViteDevServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { InlineReviewOptions } from '../types.js';
export type { InlineReviewOptions } from '../types.js';
import { ReviewStorage } from '../server/storage.js';
import { createMiddleware } from '../server/middleware.js';

const CLIENT_ROUTE = '/__inline-review/client.js';

/**
 * review-loop Vite plugin — dev-only annotation overlay.
 *
 * Registers REST API middleware and injects the client script during
 * Vite dev server. Works with any Vite-based framework (SvelteKit,
 * Nuxt, Remix, etc.). Ships zero bytes in production builds.
 */
export default function inlineReviewVite(options: InlineReviewOptions = {}): Plugin {
  let storage: ReviewStorage;
  let clientJsPath: string;

  return {
    name: 'review-loop',
    apply: 'serve',

    configureServer(server: ViteDevServer) {
      const root = server.config.root;

      // Resolve storage path relative to project root
      const storagePath = options.storagePath
        ? resolve(options.storagePath)
        : resolve(root, 'inline-review.json');

      storage = new ReviewStorage(storagePath);

      // Resolve the bundled client.js from the package's dist directory
      const __dirname = dirname(fileURLToPath(import.meta.url));
      clientJsPath = resolve(__dirname, '..', 'client.js');

      // Register REST API middleware
      server.middlewares.use(createMiddleware(storage));

      // Serve the bundled client script at a well-known route
      server.middlewares.use((req, res, next) => {
        if (req.url !== CLIENT_ROUTE) return next();
        readFile(clientJsPath, 'utf-8')
          .then(content => {
            res.writeHead(200, {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache',
            });
            res.end(content);
          })
          .catch(() => {
            res.writeHead(404);
            res.end('Client script not found');
          });
      });

      // Prevent Vite from triggering page reloads when the annotation
      // store is written by an external process (e.g. MCP server).
      // The client poller detects changes via the /version endpoint.
      server.watcher.unwatch(storagePath);
      server.watcher.unwatch(storagePath + '.tmp');
    },

    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: CLIENT_ROUTE },
          injectTo: 'body' as const,
        },
      ];
    },
  };
}
