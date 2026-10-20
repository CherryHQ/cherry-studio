import { isBuiltin } from 'node:module'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readMigrationFiles } from 'drizzle-orm/migrator'
import { defineConfig, type Plugin } from 'vite'

const repoRoot = resolve(import.meta.dirname, '../..')
const srcMain = resolve(repoRoot, 'src/main')
const runtime = (file: string) => resolve(import.meta.dirname, 'src/runtime', file)
const disabled = (file: string) => resolve(import.meta.dirname, 'src/disabled', file)
const page = (file: string) => resolve(import.meta.dirname, 'src/page', file)

/**
 * Main-process modules the data services import, swapped for browser implementations.
 * Anything not listed here must already be browser-safe; the build fails otherwise.
 */
export const workerAliases = [
  { find: /^@application$/, replacement: runtime('application.ts') },
  { find: /^@main\/core\/diagnostics$/, replacement: runtime('diagnostics.ts') },
  { find: /^@main\/core\/platform$/, replacement: runtime('platform.ts') },
  { find: /^(node:)?crypto$/, replacement: runtime('nodeCrypto.ts') },
  { find: /^(node:)?os$/, replacement: runtime('nodeOs.ts') },
  // Resolved here because the importing desktop files cannot see web-core's dependencies.
  { find: /^(node:)?path$/, replacement: fileURLToPath(import.meta.resolve('pathe')) },
  { find: /^(node:)?buffer$/, replacement: fileURLToPath(import.meta.resolve('buffer/')) },
  { find: /^(node:)?util$/, replacement: runtime('nodeUtil.ts') },
  { find: /^sharp$/, replacement: disabled('sharp.ts') },
  { find: /^better-sqlite3$/, replacement: runtime('betterSqlite3.ts') },
  {
    find: /^drizzle-orm\/better-sqlite3\/migrator$/,
    replacement: resolve(import.meta.dirname, 'src/database/migrator.ts')
  },
  { find: /^@cherrystudio\/provider-registry\/node$/, replacement: runtime('providerRegistry.ts') },
  // Workspace packages resolve from source, as in the desktop build (`mainResolveAlias`).
  { find: /^@cherrystudio\/ai-core\/provider$/, replacement: resolve(repoRoot, 'packages/aiCore/src/core/providers') },
  {
    find: /^@cherrystudio\/ai-core\/built-in\/plugins$/,
    replacement: resolve(repoRoot, 'packages/aiCore/src/core/plugins/built-in')
  },
  { find: /^@cherrystudio\/ai-core$/, replacement: resolve(repoRoot, 'packages/aiCore/src') },
  { find: /^@cherrystudio\/ai-sdk-provider$/, replacement: resolve(repoRoot, 'packages/ai-sdk-provider/src') },
  { find: /^@cherrystudio\/provider-registry$/, replacement: resolve(repoRoot, 'packages/provider-registry/src') },
  { find: /^@main\//, replacement: `${resolve(repoRoot, 'src/main')}/` },
  { find: /^@shared\//, replacement: `${resolve(repoRoot, 'src/shared')}/` },
  { find: /^@renderer\//, replacement: `${resolve(repoRoot, 'src/renderer')}/` },
  { find: /^@cherrystudio\/ui$/, replacement: resolve(repoRoot, 'packages/ui/src/index.ts') },
  { find: /^@cherrystudio\/ui\/icons$/, replacement: resolve(repoRoot, 'packages/ui/src/components/icons/index.ts') },
  { find: /^@cherrystudio\/ui\//, replacement: `${resolve(repoRoot, 'packages/ui/src')}/` }
]

/** Code that runs in the page as the desktop renderer or preload; everything else runs in the Worker. */
const pageSources = [
  resolve(repoRoot, 'src/renderer'),
  resolve(repoRoot, 'src/preload'),
  resolve(import.meta.dirname, 'src/page'),
  resolve(import.meta.dirname, 'harness/bridge.ts')
]

/** Specifiers that mean different modules in the main process and the renderer, as in the desktop build. */
const processAliases: Record<'worker' | 'page', Record<string, string>> = {
  worker: {
    '@logger': runtime('logger.ts'),
    '@data': resolve(repoRoot, 'src/main/data'),
    // Exports only what the main-process services use, so a new Electron API fails the build.
    electron: runtime('electron.ts')
  },
  page: {
    '@logger': resolve(repoRoot, 'src/renderer/services/LoggerService.ts'),
    '@data': resolve(repoRoot, 'src/renderer/data'),
    electron: page('electron.ts'),
    '@electron-toolkit/preload': page('electronToolkitPreload.ts')
  }
}

/** Resolves `processAliases` by the importer's side, since one build holds both the page and Worker code. */
export function resolveProcessAliases(): Plugin {
  return {
    name: 'resolve-process-aliases',
    enforce: 'pre',
    resolveId(id, importer, options) {
      if (!importer) return undefined
      const aliases = processAliases[pageSources.some((source) => importer.startsWith(source)) ? 'page' : 'worker']
      const name = Object.keys(aliases).find((key) => id === key || id.startsWith(`${key}/`))
      if (!name) return undefined
      return this.resolve(aliases[name] + id.slice(name.length), importer, { ...options, skipSelf: true })
    }
  }
}

/**
 * Desktop modules replaced wholesale in the Worker, keyed by their path under `src/main`.
 * Each is the entry point of a feature the Web edition leaves out, so replacing it keeps
 * everything behind it out of the bundle; its stand-in throws if the feature is used.
 */
export const workerModuleReplacements: Record<string, string> = {
  'ai/agents/AgentLifecycleService.ts': disabled('agents.ts'),
  'ai/agents/AgentWorkspaceStorageService.ts': disabled('agents.ts'),
  'ai/agents/createAgent.ts': disabled('agents.ts'),
  'ai/agents/createBuiltinAssistantSession.ts': disabled('agents.ts'),
  'ai/agents/createBuiltinSkillSession.ts': disabled('agents.ts'),
  'ai/agents/createBuiltinSupportSession.ts': disabled('agents.ts'),
  'ai/messages/attachmentTextExtraction.ts': disabled('attachments.ts'),
  'ai/messages/fileProcessor.ts': disabled('attachments.ts'),
  'ai/observability/adapters/claudeCode/ClaudeCodeTraceBridgeService.ts': disabled('tracing.ts'),
  'ai/observability/runtime/NodeTraceService.ts': disabled('tracing.ts'),
  'ai/observability/storage/TraceStorageService.ts': disabled('tracing.ts'),
  'ai/provider/custom/ollama/ollamaProvider.ts': disabled('providers.ts'),
  'ai/provider/grokCli.ts': disabled('providers.ts'),
  'ai/provider/listModels.ts': disabled('listModels.ts'),
  'ai/runtime/agentSessionWorkspace.ts': disabled('agentSessions.ts'),
  'ai/runtime/aiSdk/params/features/devtools.ts': disabled('devtools.ts'),
  'ai/runtime/fork/index.ts': disabled('agents.ts'),
  'ai/skills/SkillService.ts': disabled('skills.ts'),
  'ai/streamManager/context/AgentChatContextProvider.ts': disabled('agentSessions.ts'),
  'ai/streamManager/listeners/ChannelAdapterListener.ts': disabled('channels.ts'),
  'ai/tools/adapters/aiSdk/builtin/registerBuiltinTools.ts': disabled('builtinTools.ts'),
  'ai/utils/customFetch.ts': runtime('customFetch.ts'),
  'ai/utils/normalizeImageEditInputs.ts': disabled('images.ts'),
  'core/lifecycle/LifecycleManager.ts': disabled('lifecycle.ts'),
  'core/security/validateSender.ts': runtime('validateSender.ts'),
  'data/api/handlers/apiHandlers.ts': runtime('apiHandlers.ts'),
  'data/bootConfig/BootConfigService.ts': runtime('bootConfig.ts'),
  'data/services/utils/registryDataPaths.ts': runtime('providerRegistry.ts'),
  'ipc/handlers/ipcHandlers.ts': runtime('ipcHandlers.ts'),
  'services/CopilotService.ts': disabled('providers.ts'),
  'services/file/index.ts': disabled('files.ts'),
  'services/webSearch/WebSearchService.ts': disabled('webSearch.ts'),
  'utils/appEdition.ts': runtime('appEdition.ts'),
  'utils/builtinSkills.ts': disabled('skills.ts'),
  'utils/downloadAsBase64.ts': disabled('images.ts'),
  'utils/file/index.ts': disabled('files.ts')
}

/** Imports swapped for one desktop importer only, keyed by the importer's path under `src/main`. */
const workerImportReplacements: Record<string, Record<string, string>> = {
  // The desktop cache's persist tier is a losable file; in the Worker it lives in memory.
  'data/CacheService.ts': { 'node:fs': runtime('memoryFs.ts') }
}

export function replaceDesktopModules(): Plugin {
  return {
    name: 'replace-desktop-modules',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!importer) return undefined
      const importReplacement = workerImportReplacements[relative(srcMain, importer)]?.[id]
      if (importReplacement) return importReplacement
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true })
      const replacement = resolved && workerModuleReplacements[relative(srcMain, resolved.id)]
      return replacement ?? resolved
    }
  }
}

const MIGRATIONS_ID = 'virtual:cherry-studio-migrations'

/** Bundles the desktop migration chain, read with drizzle's own reader so hashes match the desktop. */
function migrationsPlugin(): Plugin {
  return {
    name: 'cherry-studio-migrations',
    resolveId: (id) => (id === MIGRATIONS_ID ? `\0${MIGRATIONS_ID}` : undefined),
    load(id) {
      if (id !== `\0${MIGRATIONS_ID}`) return undefined
      const migrationsFolder = resolve(repoRoot, 'migrations/sqlite-drizzle')
      this.addWatchFile(migrationsFolder)
      return `export default ${JSON.stringify(readMigrationFiles({ migrationsFolder }))}`
    }
  }
}

/**
 * Vite only warns when a browser build imports a Node built-in and the import then
 * fails at runtime. Fail the build instead, so a data service that starts using one
 * needs a replacement above before it can ship to the Worker.
 */
function forbidNodeModules(): Plugin {
  return {
    name: 'forbid-node-modules',
    enforce: 'pre',
    resolveId(id, importer) {
      if (isBuiltin(id) || id === 'electron' || id.endsWith('.node') || id.endsWith('?nodeWorker')) {
        this.error(`"${id}" (imported by ${importer}) has no browser replacement; add one to workerAliases`)
      }
      return undefined
    }
  }
}

// The non-pooled OPFS VFS needs SharedArrayBuffer, i.e. a cross-origin-isolated page.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'harness'),
  resolve: { alias: workerAliases },
  // The desktop preload exposes its API directly when context isolation is off; a page has none.
  define: { 'process.contextIsolated': 'false' },
  plugins: [resolveProcessAliases(), replaceDesktopModules(), forbidNodeModules(), migrationsPlugin()],
  worker: {
    format: 'es',
    plugins: () => [resolveProcessAliases(), replaceDesktopModules(), forbidNodeModules(), migrationsPlugin()],
    // Lazy chunks must not import from the entry file: WebKit evaluates a module Worker's
    // script again when a chunk imports it, starting a second Core Worker without a database.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'core', tags: ['$initial'], test: (id) => !id.endsWith('/harness/harnessWorker.ts') }]
        }
      }
    }
  },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/harness'),
    rolldownOptions: {
      input: {
        index: resolve(import.meta.dirname, 'harness/index.html'),
        bridge: resolve(import.meta.dirname, 'harness/bridge.html')
      }
    },
    emptyOutDir: true,
    target: 'es2022',
    reportCompressedSize: true
  }
})
