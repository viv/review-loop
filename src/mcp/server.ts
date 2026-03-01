import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReviewStorage } from '../server/storage.js';
import { register as registerListAnnotations } from './tools/list-annotations.js';
import { register as registerStartWork } from './tools/start-work.js';
import { register as registerFinishWork } from './tools/finish-work.js';

export function parseStoragePath(argv: string[]): string {
  const idx = argv.indexOf('--storage');
  const value = idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  const raw = value ?? './inline-review.json';
  return resolve(process.cwd(), raw);
}

async function main() {
  const storagePath = parseStoragePath(process.argv);
  const storage = new ReviewStorage(storagePath);

  const server = new McpServer({
    name: 'review-loop-mcp',
    version: '0.1.0',
  });

  registerListAnnotations(server, storage);
  registerStartWork(server, storage);
  registerFinishWork(server, storage);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
