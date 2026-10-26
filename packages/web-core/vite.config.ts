import { isBuiltin } from 'node:module'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readMigrationFiles } from 'drizzle-orm/migrator'
import { defineConfig, type Plugin, type Rolldown, type UserConfig } from 'vite'

const repoRoot = resolve(import.meta.dirname, '../..')
// The desktop sources to build from. An edition that composes its own source tree sets
// WEB_CORE_SOURCE_ROOT to it before loading this config.
const sourceRoot = process.env.WEB_CORE_SOURCE_ROOT ? resolve(process.env.WEB_CORE_SOURCE_ROOT) : repoRoot
const srcMain = resolve(sourceRoot, 'src/main')
const srcRenderer = resolve(sourceRoot, 'src/renderer')
const srcShared = resolve(sourceRoot, 'src/shared')
const runtime = (file: string) => resolve(import.meta.dirname, 'src/runtime', file)
const disabled = (file: string) => resolve(import.meta.dirname, 'src/disabled', file)
const page = (file: string) => resolve(import.meta.dirname, 'src/page', file)
const agent = (file: string) => resolve(import.meta.dirname, 'src/agent', file)

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
  { find: /^tar$/, replacement: resolve(import.meta.dirname, 'src/agent/tar.ts') },
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
  { find: /^@main\//, replacement: `${srcMain}/` },
  { find: /^@shared\//, replacement: `${srcShared}/` }
]

/** The renderer aliases the harness bridge page needs; the Web app uses the desktop renderer's own. */
const harnessPageAliases = [
  { find: /^@renderer\//, replacement: `${srcRenderer}/` },
  { find: /^@cherrystudio\/ui$/, replacement: resolve(sourceRoot, 'packages/ui/src/index.ts') },
  { find: /^@cherrystudio\/ui\/icons$/, replacement: resolve(sourceRoot, 'packages/ui/src/components/icons/index.ts') },
  { find: /^@cherrystudio\/ui\//, replacement: `${resolve(sourceRoot, 'packages/ui/src')}/` }
]

/** Code that runs in the page as the desktop renderer or preload; everything else runs in the Worker. */
const pageSources = [
  srcRenderer,
  resolve(sourceRoot, 'src/preload'),
  resolve(import.meta.dirname, 'src/page'),
  resolve(import.meta.dirname, 'app/main.ts'),
  resolve(import.meta.dirname, 'harness/bridge.ts')
]

/** Specifiers that mean different modules in the main process and the renderer, as in the desktop build. */
const processAliases: Record<'worker' | 'page', Record<string, string>> = {
  worker: {
    '@logger': runtime('logger.ts'),
    '@data': resolve(srcMain, 'data'),
    // Exports only what the main-process services use, so a new Electron API fails the build.
    electron: runtime('electron.ts')
  },
  page: {
    '@logger': resolve(srcRenderer, 'services/LoggerService.ts'),
    '@data': resolve(srcRenderer, 'data'),
    electron: page('electron.ts'),
    '@electron-toolkit/preload': page('electronToolkitPreload.ts')
  }
}

/**
 * Resolves `processAliases` by the importer's side, since one build holds both the page and Worker code.
 * `extraPageSources` adds an edition's own page code.
 */
export function resolveProcessAliases(extraPageSources: string[] = []): Plugin {
  const sources = [...pageSources, ...extraPageSources]
  return {
    name: 'resolve-process-aliases',
    enforce: 'pre',
    resolveId(id, importer, options) {
      if (!importer) return undefined
      const aliases = processAliases[sources.some((source) => importer.startsWith(source)) ? 'page' : 'worker']
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
 * `src/runtime` and `src/agent` replacements are browser implementations instead.
 */
export const workerModuleReplacements: Record<string, string> = {
  'ai/agentSession/fork/index.ts': disabled('forks.ts'),
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
  'ai/runtime/aiSdk/params/features/devtools.ts': disabled('devtools.ts'),
  'ai/runtime/registerDrivers.ts': agent('registerDrivers.ts'),
  'ai/runtime/fork/index.ts': disabled('forks.ts'),
  'ai/skills/SkillService.ts': disabled('skills.ts'),
  'ai/streamManager/listeners/ChannelAdapterListener.ts': disabled('channels.ts'),
  'ai/tools/adapters/aiSdk/builtin/registerBuiltinTools.ts': disabled('builtinTools.ts'),
  'ai/utils/customFetch.ts': runtime('customFetch.ts'),
  'ai/utils/normalizeImageEditInputs.ts': disabled('images.ts'),
  'core/lifecycle/LifecycleManager.ts': disabled('lifecycle.ts'),
  'core/security/validateSender.ts': runtime('validateSender.ts'),
  'data/bootConfig/BootConfigService.ts': runtime('bootConfig.ts'),
  'data/migration/v2/index.ts': runtime('migrationV2.ts'),
  'data/services/utils/registryDataPaths.ts': runtime('providerRegistry.ts'),
  'ipc/handlers/ipcHandlers.ts': runtime('ipcHandlers.ts'),
  'services/CopilotService.ts': disabled('providers.ts'),
  'services/file/index.ts': disabled('files.ts'),
  'services/webSearch/WebSearchService.ts': disabled('webSearch.ts'),
  'utils/appEdition.ts': runtime('appEdition.ts'),
  'utils/builtinSkills.ts': disabled('skills.ts'),
  'utils/downloadAsBase64.ts': disabled('images.ts'),
  'utils/file/index.ts': runtime('files.ts'),
  'utils/rtk.ts': disabled('rtk.ts')
}

/** Renderer modules replaced in the page, keyed by their path under `src/renderer`. */
const pageModuleReplacements: Record<string, string> = {
  'components/settingsMenu.ts': page('settingsMenu.ts'),
  'components/AgentRuntimeOption.tsx': page('AgentRuntimeOption.tsx'),
  'services/sentry.ts': page('sentry.ts'),
  'workers/pyodide.worker.ts?worker': page('pyodideWorker.ts')
}

/** Shared modules replaced in both the Worker and the page, keyed by their path under `src/shared`. */
const sharedModuleReplacements: Record<string, string> = {
  'ai/agentRuntimeCapabilities.ts': agent('agentRuntimeCapabilities.ts'),
  'ai/piBuiltinTools.ts': agent('piBuiltinTools.ts')
}

/**
 * Imports swapped for one desktop importer only, keyed by the importer's path under `src/main`, then
 * by the import's specifier or, for aliased imports, its resolved path under `src/main`.
 */
const workerImportReplacements: Record<string, Record<string, string>> = {
  // The desktop cache's persist tier is a losable file; in the Worker it lives in memory.
  'data/CacheService.ts': { 'node:fs': runtime('memoryFs.ts') },
  'ai/runtime/pi/approvalExtension.ts': {
    'ai/toolApproval/userDataSqliteGuard.ts': agent('userDataSqliteGuard.ts')
  },
  // The approval registry reads tool names from tool modules the Worker cannot load.
  'ai/toolApproval/builtinToolPolicyRegistry.ts': {
    'ai/tools/computerUse.ts': disabled('toolPolicyNames.ts'),
    'ai/tools/moveToTrash.ts': disabled('toolPolicyNames.ts'),
    'ai/tools/saveAttachment.ts': disabled('toolPolicyNames.ts')
  },
  // `./fs` is the desktop's stream-based file helpers; `src/runtime/files.ts` has the ones it needs.
  'utils/file/pathStatus.ts': { './fs': runtime('files.ts') }
}

export function replaceDesktopModules(): Plugin {
  return {
    name: 'replace-desktop-modules',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!importer) return undefined
      const importReplacements = workerImportReplacements[relative(srcMain, importer)]
      if (importReplacements?.[id]) return importReplacements[id]
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true })
      if (!resolved) return resolved
      const replacement =
        importReplacements?.[relative(srcMain, resolved.id)] ??
        workerModuleReplacements[relative(srcMain, resolved.id)] ??
        pageModuleReplacements[relative(srcRenderer, resolved.id)] ??
        sharedModuleReplacements[relative(srcShared, resolved.id)]
      // A wrapper such as `src/page/settingsMenu.ts` imports the module it replaces.
      return replacement && replacement !== importer ? replacement : resolved
    }
  }
}

/** Node built-ins the Worker implements on browser APIs (the page keeps Vite's browser stubs). */
const workerNodeModules: Record<string, string> = {
  fs: runtime('nodeFs.ts'),
  'fs/promises': runtime('nodeFsPromises.ts'),
  url: runtime('nodeUrl.ts')
}

/** Runs after `replaceDesktopModules`, so a per-importer replacement such as the cache's in-memory file wins. */
export function provideWorkerNodeModules(): Plugin {
  return {
    name: 'provide-worker-node-modules',
    enforce: 'pre',
    resolveId: (id) => workerNodeModules[id.replace(/^node:/, '')]
  }
}

/**
 * Desktop code, including an edition's main-process code, reads `process.platform`, which a Worker
 * lacks; no desktop OS applies (`src/runtime/platform.ts`). Dependencies guard their own reads.
 */
export function defineWorkerPlatform(): Plugin {
  return {
    name: 'define-worker-platform',
    transform(code, id) {
      if (id.includes('/node_modules/') || !code.includes('process.platform')) return undefined
      return { code: code.replaceAll('process.platform', "'browser'"), map: null }
    }
  }
}

const MIGRATIONS_ID = 'virtual:cherry-studio-migrations'

/** Bundles the desktop migration chain, read with drizzle's own reader so hashes match the desktop. */
export function migrationsPlugin(): Plugin {
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
export function forbidNodeModules(): Plugin {
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
export const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

// The desktop preload exposes its API directly when context isolation is off; a page has none.
export const pageDefines = { 'process.contextIsolated': 'false' }

/**
 * Lazy chunks must not import from a Worker entry file: WebKit evaluates a module Worker's script
 * again when a chunk imports it, starting a second Core Worker without a database.
 */
export function workerCodeSplitting(entries: string[]): Rolldown.CodeSplittingOptions {
  return { groups: [{ name: 'core', tags: ['$initial'], test: (id: string) => !entries.includes(id) }] }
}

export const coreWorkerConfig = {
  format: 'es',
  plugins: () => [
    resolveProcessAliases(),
    replaceDesktopModules(),
    provideWorkerNodeModules(),
    defineWorkerPlatform(),
    forbidNodeModules(),
    migrationsPlugin()
  ],
  rolldownOptions: {
    output: {
      // ZenFS tells its own nested calls apart by the `__patched__` function name in stack traces
      // (its `Async` mixin); mangling that name leaves the OPFS mount and its sync cache out of step.
      minify: {
        compress: { keepNames: { function: true, class: false } },
        mangle: { keepNames: { function: true, class: false } }
      },
      codeSplitting: workerCodeSplitting([
        resolve(import.meta.dirname, 'harness/harnessWorker.ts'),
        resolve(import.meta.dirname, 'app/coreWorker.ts')
      ])
    }
  }
} satisfies UserConfig['worker']

export default defineConfig({
  root: resolve(import.meta.dirname, 'harness'),
  resolve: { alias: [...workerAliases, ...harnessPageAliases] },
  define: pageDefines,
  plugins: [resolveProcessAliases(), replaceDesktopModules(), forbidNodeModules(), migrationsPlugin()],
  worker: coreWorkerConfig,
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
