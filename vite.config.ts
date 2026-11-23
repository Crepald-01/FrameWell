import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  server: { open: false },
  build: {
    rollupOptions: {
      input: {
        editor: resolve('index.html'),
        renderer: resolve('render.html'),
        sandbox: resolve('sandbox.html'),
      },
    },
  },
})
