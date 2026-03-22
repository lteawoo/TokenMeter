import path from "node:path"

import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from 'vitest/config'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: "./src/test/setup.ts",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
