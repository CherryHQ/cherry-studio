import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    target: 'es2022'
  }
})
