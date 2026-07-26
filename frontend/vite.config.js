import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Tailwind v4 يعمل عبر ملحق Vite — لا عبر PostCSS كما في v3.
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
});
