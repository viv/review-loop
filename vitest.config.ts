import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { lines: 70, functions: 70, branches: 60 },
    },
    projects: [
      {
        define: { __REVIEW_LOOP_VERSION__: JSON.stringify('test') },
        test: {
          name: 'client',
          environment: 'happy-dom',
          include: ['tests/client/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['tests/shared/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'mcp',
          environment: 'node',
          include: ['tests/mcp/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integrations',
          environment: 'node',
          include: ['tests/integrations/**/*.test.ts'],
        },
      },
    ],
  },
});
