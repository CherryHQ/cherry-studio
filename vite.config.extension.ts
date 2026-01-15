/**
 * Vite Configuration for Chrome Extension Build
 *
 * This configuration builds the Cherry Studio renderer as a Chrome extension,
 * reusing the existing React UI with the window.api shim.
 */
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'fs'

const isProd = process.env.NODE_ENV === 'production'

// Plugin to copy manifest and assets
function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist-extension')

      // Copy manifest
      copyFileSync(resolve(__dirname, 'src/extension/manifest.json'), resolve(outDir, 'manifest.json'))

      // Create icons directory and copy icons
      const iconsDir = resolve(outDir, 'icons')
      if (!existsSync(iconsDir)) {
        mkdirSync(iconsDir, { recursive: true })
      }

      // Copy logo as icons (you'll want to create proper icon sizes)
      const logoSrc = resolve(__dirname, 'src/renderer/src/assets/images/logo.png')
      if (existsSync(logoSrc)) {
        copyFileSync(logoSrc, resolve(iconsDir, 'icon16.png'))
        copyFileSync(logoSrc, resolve(iconsDir, 'icon48.png'))
        copyFileSync(logoSrc, resolve(iconsDir, 'icon128.png'))
      }

      // Copy assets directory
      const assetsSrc = resolve(__dirname, 'src/renderer/src/assets')
      const assetsDst = resolve(outDir, 'assets')
      if (existsSync(assetsSrc)) {
        cpSync(assetsSrc, assetsDst, { recursive: true })
      }
    }
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react({ tsDecorators: true }),
    copyExtensionFiles()
  ],

  define: {
    // Mark as extension build
    'import.meta.env.VITE_IS_EXTENSION': JSON.stringify(true),
    'import.meta.env.VITE_PLATFORM': JSON.stringify('extension'),
    // Prevent Electron-specific code from running
    'process.env.ELECTRON_DISABLE_SECURITY_WARNINGS': JSON.stringify(true)
  },

  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'packages/shared'),
      '@types': resolve(__dirname, 'src/renderer/src/types'),
      '@logger': resolve(__dirname, 'src/renderer/src/services/LoggerService'),
      '@mcp-trace/trace-core': resolve(__dirname, 'packages/mcp-trace/trace-core'),
      '@mcp-trace/trace-web': resolve(__dirname, 'packages/mcp-trace/trace-web'),
      '@cherrystudio/ai-core/provider': resolve(__dirname, 'packages/aiCore/src/core/providers'),
      '@cherrystudio/ai-core/built-in/plugins': resolve(__dirname, 'packages/aiCore/src/core/plugins/built-in'),
      '@cherrystudio/ai-core': resolve(__dirname, 'packages/aiCore/src'),
      '@cherrystudio/extension-table-plus': resolve(__dirname, 'packages/extension-table-plus/src'),
      '@cherrystudio/ai-sdk-provider': resolve(__dirname, 'packages/ai-sdk-provider/src'),
      // Shim the preload imports
      '../preload': resolve(__dirname, 'src/extension/shim.ts')
    }
  },

  optimizeDeps: {
    exclude: ['pyodide'],
    esbuildOptions: {
      target: 'esnext'
    }
  },

  worker: {
    format: 'es'
  },

  build: {
    outDir: 'dist-extension',
    target: 'esnext',
    emptyOutDir: true,
    sourcemap: !isProd,

    rollupOptions: {
      input: {
        // Main UI entry points
        sidepanel: resolve(__dirname, 'src/extension/sidepanel.html'),
        popup: resolve(__dirname, 'src/extension/popup.html'),
        // Background service worker
        background: resolve(__dirname, 'src/extension/background.ts'),
        // Content script
        content: resolve(__dirname, 'src/extension/content.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      },
      onwarn(warning, warn) {
        // Ignore certain warnings
        if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      }
    }
  },

  esbuild: isProd ? { legalComments: 'none' } : {}
})
