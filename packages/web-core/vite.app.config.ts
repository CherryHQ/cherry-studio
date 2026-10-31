import { resolve } from 'node:path'

import { defineConfig, loadConfigFromFile, type UserConfig } from 'vite'

import {
  coreWorkerConfig,
  crossOriginIsolation,
  pageDefines,
  replaceDesktopModules,
  resolveProcessAliases,
  workerAliases
} from './vite.config'

const repoRoot = resolve(import.meta.dirname, '../..')
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The Web app is the desktop main window, so it builds with the desktop renderer config. That config
// resolves paths against the working directory, so this one runs from the repo root (`build:app`).
const desktop = (await loadConfigFromFile(
  { command: 'build', mode: 'production' },
  resolve(repoRoot, 'electron.vite.config.ts')
))!.config as { renderer: UserConfig & { resolve: { alias: Record<string, string> } } }
const renderer = desktop.renderer

// `@logger` and `@data` resolve by the importer's side (`resolveProcessAliases`).
const rendererAliases = Object.entries(renderer.resolve.alias)
  .filter(([name]) => name !== '@logger' && name !== '@data')
  .map(([name, replacement]) => ({ find: new RegExp(`^${escapeRegExp(name)}(?=/|$)`), replacement }))

export default defineConfig({
  root: resolve(import.meta.dirname, 'app'),
  resolve: { alias: [...workerAliases, ...rendererAliases] },
  define: { ...renderer.define, ...pageDefines },
  // No `forbidNodeModules` here: the page keeps Vite's browser stubs for Node built-ins, as the desktop renderer does.
  plugins: [resolveProcessAliases(), replaceDesktopModules(), ...(renderer.plugins ?? [])],
  worker: coreWorkerConfig,
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/app'),
    emptyOutDir: true,
    target: 'es2022'
  }
})
