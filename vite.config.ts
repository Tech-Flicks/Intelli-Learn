/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * `/ai-proxy` goes to the optional AI proxy (`npm run proxy`, port 8788), so the "Proxy" AI
 * mode can be tried in development and preview the same way nginx serves it in Docker.
 * `changeOrigin` must stay false: the proxy only answers requests whose Origin matches the
 * Host header (same-origin use), so the browser's Host has to arrive unchanged.
 */
const aiProxy = {
  '/ai-proxy': { target: process.env.AI_PROXY_TARGET ?? 'http://localhost:8788', changeOrigin: false },
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Intelli-Learn',
        short_name: 'Intelli-Learn',
        description: 'Playful AI-guided STEM adventures for kids.',
        theme_color: '#5b4bdb',
        background_color: '#fbfaff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The interface is English, Spanish and Hindi: font subsets for other scripts are not
        // precached. They are still served on demand if a nickname ever needs them.
        globIgnores: ['**/*cyrillic*', '**/*vietnamese*'],
        navigateFallback: '/index.html',
        // Never cache AI traffic.
        navigateFallbackDenylist: [/^\/ai-proxy\//],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rolldownOptions: {
      output: {
        // Libraries change far less often than the app's own code. In their own files they
        // stay cached on the device across app updates, and the start-up file stays small.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  server: { port: 5173, host: true, proxy: aiProxy },
  preview: { proxy: aiProxy },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.{ts,mjs}', 'tools/**/*.test.{ts,mjs}'],
    css: false,
  },
});
