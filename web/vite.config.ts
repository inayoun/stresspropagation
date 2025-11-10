import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/StressPropagation/' : '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}))