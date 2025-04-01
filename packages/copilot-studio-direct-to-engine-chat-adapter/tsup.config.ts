import { defineConfig, type Options } from 'tsup';

const BASE_CONFIG: Options = {
  dts: true,
  env: {
    npm_package_version: process.env.npm_package_version || '0.0.0-0'
  },
  format: ['cjs', 'esm'],
  platform: 'browser',
  sourcemap: true,
  target: ['chrome110', 'edge110', 'firefox110', 'ios16', 'node20']
};

export default defineConfig([
  {
    ...BASE_CONFIG,
    entry: { 'copilot-studio-direct-to-engine-chat-adapter': './src/index.ts' }
  },
  {
    ...BASE_CONFIG,
    entry: { 'copilot-studio-direct-to-engine-chat-adapter.experimental': './src/experimental/index.ts' }
  },
  {
    ...BASE_CONFIG,
    entry: { 'copilot-studio-direct-to-engine-chat-adapter.bundle': './src/index.ts' },
    noExternal: [/./u],
    minify: true
  },
  {
    ...BASE_CONFIG,
    entry: { 'copilot-studio-direct-to-engine-chat-adapter.experimental-bundle': './src/experimental/index.ts' },
    noExternal: [/./u],
    minify: true
  },
  {
    ...BASE_CONFIG,
    dts: false,
    entry: { 'copilot-studio-direct-to-engine-chat-adapter.development': './src/index.global.ts' },
    format: 'iife'
  },
  {
    ...BASE_CONFIG,
    dts: false,
    entry: { 'copilot-studio-direct-to-engine-chat-adapter.production': './src/index.global.ts' },
    format: 'iife',
    minify: true
  }
]);
