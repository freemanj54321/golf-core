import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@golf-core': resolve(__dirname, '../core/src'),
    },
    dedupe: ['firebase', 'react', 'react-dom'],
  },
});
