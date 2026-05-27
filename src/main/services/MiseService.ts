import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getBinaryPath } from '@main/utils/process'
import type { MiseState, MiseTool, ToolInstallState } from '@shared/data/preference/preferenceTypes'
import { PREDEFINED_MISE_TOOLS } from '@shared/data/presets/mise-tools'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow } from 'electron'

const logger = loggerService.withContext('MiseService')

const execFileAsync = promisify(execFile)

interface ReconcileResult {
  installed: string[]
  failed: Array<{ name: string; error: string }>
  skipped: string[]
  stateSaveError?: string
}

const MISE_PASSTHROUGH_ENV = [
  'PATH',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'GITHUB_TOKEN',
  'GH_TOKEN'
]

const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/
const TOOL_KEY_RE = /^(?!.*\.\.)(?!.*\/\/)[a-zA-Z0-9@:/_.-]+$/

const RUNTIME_DEPS: Record<string, string> = { npm: 'node@22', pipx: 'python@3.12' }

const REGISTRY_CACHE_TTL_MS = 10 * 60 * 1000

export function validateMiseTool(tool: MiseTool): void {
  if (!tool.name || !TOOL_NAME_RE.test(tool.name)) {
    throw new Error(`Invalid tool name: ${tool.name}`)
  }
  if (!tool.tool || !TOOL_KEY_RE.test(tool.tool)) {
    throw new Error(`Invalid tool key: ${tool.tool}`)
  }
  if (tool.version && !TOOL_KEY_RE.test(tool.version)) {
    throw new Error(`Invalid tool version: ${tool.version}`)
  }
}

@Injectable('MiseService')
@ServicePhase(Phase.Background)
export class MiseService extends BaseService {
  private miseBin: string | null = null
  private isolatedEnv: Record<string, string> | null = null
  private registryCache: Array<{ name: string; tool: string }> | null = null
  private registryCacheTime = 0
  private stateLock: Promise<unknown> = Promise.resolve()

  protected async onInit() {
    this.registerIpcHandlers()
    await this.extractBundledBinaries()
    this.miseBin = this.findMiseBin()
    if (!this.miseBin) {
      logger.warn('mise binary not found, tool management disabled')
      return
    }
    logger.info('mise binary found', { path: this.miseBin })
    this.isolatedEnv = this.buildIsolatedEnv()

    const prefService = application.get('PreferenceService')
    let tools = prefService.get('feature.mise.tools')
    if (tools.length === 0) {
      const coreTools: MiseTool[] = PREDEFINED_MISE_TOOLS.filter((t) => t.coreDep).map((t) => ({
        name: t.name,
        tool: t.tool
      }))
      if (coreTools.length > 0) {
        void prefService.set('feature.mise.tools', coreTools)
        tools = coreTools
        logger.info('Auto-seeded core dependency tools', { tools: coreTools.map((t) => t.name) })
      }
    }
    if (tools.length > 0) {
      this.reconcile(tools).catch((err) => logger.error('Initial reconcile failed', err))
    }
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.Mise_Reconcile, async () => {
      const tools = application.get('PreferenceService').get('feature.mise.tools')
      return this.reconcile(tools)
    })

    this.ipcHandle(IpcChannel.Mise_InstallTool, async (_event, tool: MiseTool) => {
      validateMiseTool(tool)
      return this.installTool(tool)
    })

    this.ipcHandle(IpcChannel.Mise_RemoveTool, async (_event, toolName: string) => {
      if (!toolName || !TOOL_NAME_RE.test(toolName)) {
        throw new Error(`Invalid tool name: ${toolName}`)
      }
      return this.removeTool(toolName)
    })

    this.ipcHandle(IpcChannel.Mise_GetState, async () => {
      return this.loadState()
    })

    this.ipcHandle(IpcChannel.Mise_SearchRegistry, async (_event, query: string) => {
      if (typeof query !== 'string') return []
      return this.searchRegistry(query)
    })

    this.ipcHandle(IpcChannel.Mise_GetToolDir, async (_event, toolName: string) => {
      if (!toolName || !TOOL_NAME_RE.test(toolName)) {
        throw new Error(`Invalid tool name: ${toolName}`)
      }
      const binPath = await getBinaryPath(toolName)
      return path.dirname(binPath)
    })
  }

  private async extractBundledBinaries(): Promise<void> {
    const platformKey = `${process.platform}-${process.arch}`
    const bundledDir = path.join(application.getPath('app.root.resources.binaries'), platformKey)
    const binDir = application.getPath('cherry.bin')
    await fsp.mkdir(binDir, { recursive: true })

    const tools: Array<{ name: string; binaries: string[]; versionFile: string }> = [
      { name: 'mise', binaries: [isWin ? 'mise.exe' : 'mise'], versionFile: '.mise-version' },
      { name: 'bun', binaries: [isWin ? 'bun.exe' : 'bun'], versionFile: '.bun-version' },
      { name: 'uv', binaries: isWin ? ['uv.exe', 'uvx.exe'] : ['uv', 'uvx'], versionFile: '.uv-version' }
    ]

    for (const tool of tools) {
      const bundledVersion = this.readVersionMarker(path.join(bundledDir, tool.versionFile))
      if (!bundledVersion) continue

      const firstBundled = path.join(bundledDir, tool.binaries[0])
      if (!fs.existsSync(firstBundled)) continue

      const installedVersion = this.readVersionMarker(path.join(binDir, tool.versionFile))
      const firstDest = path.join(binDir, tool.binaries[0])
      if (fs.existsSync(firstDest) && bundledVersion === installedVersion) continue

      for (const bin of tool.binaries) {
        const src = path.join(bundledDir, bin)
        const dest = path.join(binDir, bin)
        if (!fs.existsSync(src)) continue
        await fsp.copyFile(src, dest)
        if (!isWin) await fsp.chmod(dest, 0o755)
      }
      await fsp.writeFile(path.join(binDir, tool.versionFile), bundledVersion)
      logger.info(`Extracted bundled ${tool.name}`, { binDir, version: bundledVersion })
    }
  }

  private readVersionMarker(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf-8').trim() || null
    } catch {
      return null
    }
  }

  private findMiseBin(): string | null {
    const binaryName = isWin ? 'mise.exe' : 'mise'

    const cherryBin = path.join(application.getPath('cherry.bin'), binaryName)
    if (fs.existsSync(cherryBin)) {
      return cherryBin
    }

    try {
      const cmd = isWin ? 'where' : 'which'
      const result = execFileSync(cmd, [binaryName], { encoding: 'utf-8', timeout: 5000 })
      const systemPath = result.trim().split('\n')[0]
      if (systemPath && fs.existsSync(systemPath)) {
        return systemPath
      }
    } catch {
      // not on PATH
    }

    return null
  }

  // Intentionally isolates HOME/XDG to prevent mise from reading user-level
  // configs (.npmrc, .netrc, etc.). Only public registry installs are supported;
  // private registry auth tokens are not passed through.
  private buildIsolatedEnv(): Record<string, string> {
    const dataDir = application.getPath('feature.mise.data')
    const env: Record<string, string> = {}

    for (const key of MISE_PASSTHROUGH_ENV) {
      const val = process.env[key]
      if (val !== undefined) {
        env[key] = val
      }
    }

    env['MISE_DATA_DIR'] = dataDir
    env['MISE_CONFIG_DIR'] = path.join(dataDir, 'config')
    env['MISE_CACHE_DIR'] = path.join(dataDir, 'cache')
    env['MISE_STATE_DIR'] = path.join(dataDir, 'state')
    env['MISE_SHIMS_DIR'] = path.join(dataDir, 'shims')
    env['HOME'] = path.join(dataDir, 'home')
    env['XDG_CONFIG_HOME'] = path.join(dataDir, 'xdg', 'config')
    env['XDG_CACHE_HOME'] = path.join(dataDir, 'xdg', 'cache')
    env['XDG_STATE_HOME'] = path.join(dataDir, 'xdg', 'state')
    env['MISE_YES'] = '1'
    env['MISE_NO_ANALYTICS'] = '1'
    env['MISE_EXPERIMENTAL'] = '1'

    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || (isWin ? 'Path' : 'PATH')
    const pathSegments = [
      env['MISE_SHIMS_DIR'],
      this.miseBin ? path.dirname(this.miseBin) : '',
      env[pathKey] || ''
    ].filter(Boolean)
    env[pathKey] = pathSegments.join(path.delimiter)
    if (!isWin) {
      env['PATH'] = env[pathKey]
    }

    if (isWin) {
      env['USERPROFILE'] = env['HOME']
    }

    for (const key of [
      'MISE_DATA_DIR',
      'MISE_CONFIG_DIR',
      'MISE_CACHE_DIR',
      'MISE_STATE_DIR',
      'MISE_SHIMS_DIR',
      'HOME',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'XDG_STATE_HOME'
    ]) {
      fs.mkdirSync(env[key], { recursive: true })
    }

    return env
  }

  private async runMise(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    if (!this.miseBin) {
      throw new Error('mise binary not available')
    }
    return execFileAsync(this.miseBin, args, { cwd, env: this.isolatedEnv!, timeout: 120_000 })
  }

  private withStateLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.stateLock.then(
      () => fn(),
      () => fn()
    )
    this.stateLock = next.catch(() => {})
    return next
  }

  private async isMiseToolReady(toolName: string): Promise<boolean> {
    try {
      await this.runMise(['which', toolName], os.tmpdir())
      return true
    } catch {
      return false
    }
  }

  private async installWithMise(tool: MiseTool): Promise<string> {
    const version = tool.version || 'latest'
    const backend = tool.tool.split(':')[0]
    const runtime = RUNTIME_DEPS[backend]
    const toolSpec = `${tool.tool}@${version}`
    const args = ['use', '-g', ...(runtime ? [runtime] : []), toolSpec]

    await this.runMise(args, os.tmpdir())
    await this.runMise(['reshim'], os.tmpdir())

    try {
      const { stdout: lsOut } = await this.runMise(['ls', '--json', tool.tool], os.tmpdir())
      const lsData = JSON.parse(lsOut) as Record<string, Array<{ version?: string }>>
      const entries = Object.values(lsData).flat()
      if (entries.length > 0 && entries[0].version) {
        return entries[0].version
      }
    } catch {
      logger.warn('Failed to query installed version via mise ls', { tool: tool.tool })
    }
    return version
  }

  private loadState(): MiseState {
    const statePath = application.getPath('feature.mise.state_file')
    try {
      const data = fs.readFileSync(statePath, 'utf-8')
      const parsed = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object' || typeof parsed.tools !== 'object' || parsed.tools === null) {
        return { updatedAt: '', tools: {} }
      }
      const validTools: Record<string, ToolInstallState> = {}
      for (const [key, entry] of Object.entries(parsed.tools)) {
        const e = entry as Record<string, unknown>
        if (
          e &&
          typeof e === 'object' &&
          typeof e.name === 'string' &&
          typeof e.tool === 'string' &&
          typeof e.version === 'string' &&
          TOOL_KEY_RE.test(e.tool)
        ) {
          validTools[key] = e as unknown as ToolInstallState
        } else {
          logger.warn('Discarding malformed tool entry from state', { key })
        }
      }
      return { updatedAt: String(parsed.updatedAt ?? ''), tools: validTools }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { updatedAt: '', tools: {} }
      }
      logger.error('Failed to load mise state', err as Error)
      throw err
    }
  }

  private saveState(state: MiseState) {
    const statePath = application.getPath('feature.mise.state_file')
    const dir = path.dirname(statePath)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = statePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
    fs.renameSync(tmp, statePath)
    this.broadcastState(state)
  }

  private broadcastState(state: MiseState) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannel.Mise_StateChanged, state)
      }
    }
  }

  async reconcile(tools: MiseTool[]): Promise<ReconcileResult> {
    if (!this.miseBin) {
      return { installed: [], failed: [{ name: '*', error: 'mise binary not available' }], skipped: [] }
    }

    return this.withStateLock(async () => {
      const state = this.loadState()
      const result: ReconcileResult = { installed: [], failed: [], skipped: [] }

      for (const tool of tools) {
        try {
          validateMiseTool(tool)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn('Skipping invalid tool from preferences', { name: tool.name, error: msg })
          result.failed.push({ name: tool.name, error: msg })
          continue
        }

        const existing = state.tools[tool.name]
        if (existing && existing.tool === tool.tool && (await this.isMiseToolReady(tool.name))) {
          if (!tool.version || existing.version === tool.version) {
            result.skipped.push(tool.name)
            continue
          }
        }

        try {
          logger.info('Installing tool', { name: tool.name, tool: tool.tool, version: tool.version || 'latest' })
          const installedVersion = await this.installWithMise(tool)
          state.tools[tool.name] = {
            name: tool.name,
            tool: tool.tool,
            version: installedVersion,
            installedAt: new Date().toISOString()
          }
          result.installed.push(tool.name)
          logger.info('Tool installed', { name: tool.name, version: installedVersion })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.error('Tool install failed', { name: tool.name, error: msg })
          result.failed.push({ name: tool.name, error: msg })
        }
      }

      try {
        state.updatedAt = new Date().toISOString()
        this.saveState(state)
      } catch (err) {
        logger.error('Failed to persist reconcile state', err as Error)
        result.stateSaveError = err instanceof Error ? err.message : String(err)
      }
      this.broadcastReconcileFailures(result.failed)

      return result
    })
  }

  async installTool(tool: MiseTool): Promise<{ version: string }> {
    if (!this.miseBin) {
      throw new Error('mise binary not available')
    }

    return this.withStateLock(async () => {
      const version = await this.installWithMise(tool)
      const state = this.loadState()
      state.tools[tool.name] = {
        name: tool.name,
        tool: tool.tool,
        version,
        installedAt: new Date().toISOString()
      }
      state.updatedAt = new Date().toISOString()
      this.saveState(state)

      return { version }
    })
  }

  private async loadRegistry(): Promise<Array<{ name: string; tool: string }>> {
    if (this.registryCache && Date.now() - this.registryCacheTime < REGISTRY_CACHE_TTL_MS) {
      return this.registryCache
    }

    const { stdout } = await this.runMise(['registry'], os.tmpdir())
    const entries: Array<{ name: string; tool: string }> = []

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const match = line.match(/^(\S+)\s+(.+)$/)
      if (!match) continue
      const [, name, backends] = match
      const tool = backends.trim().split(/\s+/)[0]
      entries.push({ name, tool })
    }

    this.registryCache = entries
    this.registryCacheTime = Date.now()
    return entries
  }

  async searchRegistry(query: string): Promise<Array<{ name: string; tool: string }>> {
    if (!this.miseBin || !query.trim()) {
      return []
    }

    const registry = await this.loadRegistry()
    const q = query.toLowerCase()
    return registry.filter((entry) => entry.name.toLowerCase().includes(q)).slice(0, 50)
  }

  private broadcastReconcileFailures(failed: ReconcileResult['failed']) {
    if (failed.length === 0 || (failed.length === 1 && failed[0].name === '*')) return
    const names = failed.map((f) => f.name).join(', ')
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannel.Mise_ReconcileFailed, names)
      }
    }
  }

  async removeTool(toolName: string): Promise<void> {
    return this.withStateLock(async () => {
      const state = this.loadState()
      const existing = state.tools[toolName]
      if (!existing) return

      if (this.miseBin) {
        try {
          await this.runMise(['unuse', '-g', existing.tool], os.tmpdir())
          await this.runMise(['reshim'], os.tmpdir())
        } catch (err) {
          logger.warn('Failed to unuse mise tool', {
            name: toolName,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }

      delete state.tools[toolName]
      state.updatedAt = new Date().toISOString()
      this.saveState(state)
    })
  }
}
