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
  // @habit-tracker/core is a symlinked npm-workspaces package written in
  // CommonJS. Without explicit pre-bundling Vite serves the raw CJS file as
  // native ESM, and every named import (generateId, evaluateHabitStatus, …)
  // fails with "does not provide an export named …" — the dev server showed
  // a blank page until this was added.
  optimizeDeps: {
    include: ['@habit-tracker/core']
  },
  build: {
    outDir: 'dist'
  }
})
