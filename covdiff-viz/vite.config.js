import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Use /covdiff/ for GitHub Pages, ./ for Electron
  const base = mode === 'gh-pages' ? '/covdiff/' : './';
  
  return {
    plugins: [react()],
    base,
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
  };
});
