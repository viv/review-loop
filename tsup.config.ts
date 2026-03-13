import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig([
  // Server/integration entry — Node APIs, not bundled
  {
    entry: { index: 'src/index.ts', 'integrations/vite': 'src/integrations/vite.ts', 'integrations/express': 'src/integrations/express.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['astro', 'vite', 'node:fs', 'node:fs/promises', 'node:path'],
  },
  // Client entry — browser code, fully bundled into a single file
  {
    entry: { client: 'src/client/index.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    // Bundle everything into one file — no external deps in the browser
    noExternal: [/.*/],
    platform: 'browser',
    define: { __REVIEW_LOOP_VERSION__: JSON.stringify(pkg.version) },
  },
  // MCP server entry — CLI executable, runtime deps externalised
  {
    entry: { 'mcp/server': 'src/mcp/server.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    external: ['@modelcontextprotocol/sdk', 'zod', 'node:fs', 'node:fs/promises', 'node:path'],
  },
]);
