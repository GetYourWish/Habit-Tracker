import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate from vite.config.js so the production build config stays untouched.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Board tests need window.matchMedia / ResizeObserver mocks; defined in
    // src/test-setup.js which is loaded for every test file.
    setupFiles: ['./src/test-setup.js']
  }
})
