import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    watch: {
      ignored: ['**/.vs/**', '**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', '**/.git/**', '**/.backups/**']
    }
  },
  build: {
    outDir: 'dist'
  }
})
