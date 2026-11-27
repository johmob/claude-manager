import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // node:sqlite is only reachable with the node: prefix, so it is not in electron-vite's built-in externals list.
  main: { build: { rollupOptions: { external: ['node:sqlite'] } } },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
