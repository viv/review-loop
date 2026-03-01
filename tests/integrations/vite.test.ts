import { describe, it, expect, vi, beforeEach } from 'vitest';
import inlineReviewVite from '../../src/integrations/vite.js';

// Mock minimal ViteDevServer
function createMockServer(root = '/tmp/test-project') {
  const middlewares: Array<unknown> = [];
  const unwatched: string[] = [];

  return {
    server: {
      config: { root },
      middlewares: {
        use: vi.fn((handler: unknown) => { middlewares.push(handler); }),
      },
      watcher: {
        unwatch: vi.fn((path: string) => { unwatched.push(path); }),
      },
    },
    getMiddlewares: () => middlewares,
    getUnwatched: () => unwatched,
  };
}

describe('Vite plugin adapter', () => {
  let plugin: ReturnType<typeof inlineReviewVite>;

  beforeEach(() => {
    plugin = inlineReviewVite();
  });

  it('has correct plugin name', () => {
    expect(plugin.name).toBe('review-loop');
  });

  it('applies only during dev (serve)', () => {
    expect(plugin.apply).toBe('serve');
  });

  it('has configureServer as a function', () => {
    expect(typeof plugin.configureServer).toBe('function');
  });

  it('has transformIndexHtml as a function', () => {
    expect(typeof plugin.transformIndexHtml).toBe('function');
  });

  it('accepts custom storagePath option', () => {
    const custom = inlineReviewVite({ storagePath: '/tmp/custom.json' });
    expect(custom.name).toBe('review-loop');
  });

  describe('configureServer', () => {
    it('registers middleware and unwatches storage paths', () => {
      const { server, getUnwatched } = createMockServer();

      // configureServer is typed as a function or object — call it directly
      const configureServer = plugin.configureServer as (server: typeof server) => void;
      configureServer(server);

      // Should register 2 middlewares: API handler + client script server
      expect(server.middlewares.use).toHaveBeenCalledTimes(2);

      // Should unwatch the storage file and its tmp file
      const unwatched = getUnwatched();
      expect(unwatched).toHaveLength(2);
      expect(unwatched[0]).toMatch(/inline-review\.json$/);
      expect(unwatched[1]).toMatch(/inline-review\.json\.tmp$/);
    });

    it('unwatches custom storage path when specified', () => {
      const customPlugin = inlineReviewVite({ storagePath: '/tmp/custom.json' });
      const { server, getUnwatched } = createMockServer();

      const configureServer = customPlugin.configureServer as (server: typeof server) => void;
      configureServer(server);

      const unwatched = getUnwatched();
      expect(unwatched[0]).toBe('/tmp/custom.json');
      expect(unwatched[1]).toBe('/tmp/custom.json.tmp');
    });
  });

  describe('transformIndexHtml', () => {
    it('returns script tag for client injection', () => {
      const transformIndexHtml = plugin.transformIndexHtml as () => Array<{
        tag: string;
        attrs: Record<string, string>;
        injectTo: string;
      }>;

      const tags = transformIndexHtml();
      expect(tags).toHaveLength(1);
      expect(tags[0]).toEqual({
        tag: 'script',
        attrs: { type: 'module', src: '/__inline-review/client.js' },
        injectTo: 'body',
      });
    });
  });
});
