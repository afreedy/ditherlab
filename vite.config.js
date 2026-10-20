import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: { rollupOptions: { input: { dither: resolve(import.meta.dirname, 'index.html'), editor: resolve(import.meta.dirname, 'image-editor.html') } } },
})
