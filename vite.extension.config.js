import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const extRoot = resolve(__dirname, 'chrome-extension')
const outDir = resolve(extRoot, 'build')

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'copy-extension-static',
      closeBundle() {
        mkdirSync(outDir, { recursive: true })
        copyFileSync(resolve(extRoot, 'manifest.json'), resolve(outDir, 'manifest.json'))
        copyFileSync(resolve(extRoot, 'options.html'), resolve(outDir, 'options.html'))
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/index.ts'),
      output: {
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
        assetFileNames(assetInfo) {
          if (assetInfo.names?.[0]?.endsWith('.css')) return 'content.css'
          if (assetInfo.name?.endsWith('.css')) return 'content.css'
          return 'assets/[name][extname]'
        },
      },
    },
  },
})
