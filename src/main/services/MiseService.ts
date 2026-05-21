import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import predefinedTools from '@shared/data/predefined-tools.json'
import type { MiseTool } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow } from 'electron'

const logger = loggerService.withContext('MiseService')

const execFileAsync = promisify(execFile)

interface BinaryInstallState {
  name: string
  tool: string
  version: string
  installedAt: string
}

interface MiseState {
  updatedAt: string
  tools: Record<string, BinaryInstallState>
}

interface ReconcileResult {
  installed: string[]
  failed: Array<{ name: string; error: string }>
  skipped: string[]
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

const WRAPPER_BACKENDS = new Set(['npm', 'pipx'])

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
    this.extractBundledBinary()
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
      const coreTools: MiseTool[] = predefinedTools
        .filter((t) => t.coreDep)
        .map((t) => ({ name: t.name, tool: t.tool }))
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
      return this.searchRegistry(query)
    })
  }

  private extractBundledBinary(): void {
    const platformKey = `${process.platform}-${process.arch}`
    const binaryName = isWin ? 'mise.exe' : 'mise'
    const bundledDir = path.join(application.getPath('app.root.resources.binaries'), platformKey)
    const bundled = path.join(bundledDir, binaryName)

    if (!fs.existsSync(bundled)) {
      return
    }

    const binDir = application.getPath('cherry.bin')
    fs.mkdirSync(binDir, { recursive: true })
    const dest = path.join(binDir, binaryName)
    const versionMarker = path.join(binDir, '.mise-version')

    const bundledVersion = this.readVersionMarker(path.join(bundledDir, '.mise-version'))
    const installedVersion = this.readVersionMarker(versionMarker)

    if (fs.existsSync(dest) && bundledVersion && bundledVersion === installedVersion) {
      return
    }

    fs.copyFileSync(bundled, dest)
    if (!isWin) {
      fs.chmodSync(dest, 0o755)
    }
    if (bundledVersion) {
      fs.writeFileSync(versionMarker, bundledVersion)
    }
    logger.info('Extracted bundled mise binary', { dest, version: bundledVersion })
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

    if (isWin) {
      env['USERPROFILE'] = env['HOME']
    }

    for (const dir of Object.values(env)) {
      if (dir.startsWith(dataDir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
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
    const next = this.stateLock.then(fn, fn)
    this.stateLock = next.catch(() => {})
    return next
  }

  private async installBinary(tool: MiseTool): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-mise-'))
    try {
      const version = tool.version || 'latest'
      const tomlContent = `[tools]\n"${tool.tool}" = "${version}"\n`
      fs.writeFileSync(path.join(tmpDir, 'mise.toml'), tomlContent)

      await this.runMise(['trust', tmpDir], tmpDir)
      await this.runMise(['install', tool.tool], tmpDir)

      const { stdout: versionOut } = await this.runMise(['which', tool.name, '--version'], tmpDir)
      const installedVersion = versionOut.trim()

      const binDir = application.getPath('cherry.bin')
      fs.mkdirSync(binDir, { recursive: true })

      const backend = tool.tool.split(':')[0]
      if (WRAPPER_BACKENDS.has(backend)) {
        const dstPath = path.join(binDir, isWin ? `${tool.name}.cmd` : tool.name)
        this.writeToolWrapper(dstPath, tool, installedVersion)
      } else {
        const { stdout: srcPath } = await this.runMise(['which', tool.name], tmpDir)
        const trimmedPath = srcPath.trim()
        if (!trimmedPath) {
          throw new Error(`mise which ${tool.name} returned empty path`)
        }
        const dstPath = path.join(binDir, isWin ? `${tool.name}.exe` : tool.name)
        fs.copyFileSync(trimmedPath, dstPath)
        if (!isWin) {
          fs.chmodSync(dstPath, 0o755)
        }
      }

      return installedVersion
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  private writeToolWrapper(dstPath: string, tool: MiseTool, version: string): void {
    const dataDir = application.getPath('feature.mise.data')
    const miseBin = this.miseBin!
    if (isWin) {
      const script = `@echo off\r\nset "MISE_DATA_DIR=${dataDir}"\r\nset "MISE_YES=1"\r\n"${miseBin}" x "${tool.tool}@${version}" -- "${tool.name}" %*\r\n`
      fs.writeFileSync(dstPath, script)
    } else {
      const script = `#!/bin/sh\nMISE_DATA_DIR='${dataDir}' MISE_YES=1 exec '${miseBin}' x '${tool.tool}@${version}' -- '${tool.name}' "$@"\n`
      fs.writeFileSync(dstPath, script, { mode: 0o755 })
    }
  }

  private loadState(): MiseState {
    const statePath = application.getPath('feature.mise.state_file')
    try {
      const data = fs.readFileSync(statePath, 'utf-8')
      const parsed = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object' || typeof parsed.tools !== 'object' || parsed.tools === null) {
        return { updatedAt: '', tools: {} }
      }
      return { updatedAt: String(parsed.updatedAt ?? ''), tools: parsed.tools }
    } catch {
      return { updatedAt: '', tools: {} }
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
        const existing = state.tools[tool.name]
        if (existing && tool.version && existing.version === tool.version) {
          result.skipped.push(tool.name)
          continue
        }
        if (existing && !tool.version) {
          result.skipped.push(tool.name)
          continue
        }

        try {
          logger.info('Installing tool', { name: tool.name, tool: tool.tool, version: tool.version || 'latest' })
          const installedVersion = await this.installBinary(tool)
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

      state.updatedAt = new Date().toISOString()
      this.saveState(state)

      return result
    })
  }

  async installTool(tool: MiseTool): Promise<{ version: string }> {
    if (!this.miseBin) {
      throw new Error('mise binary not available')
    }

    return this.withStateLock(async () => {
      const version = await this.installBinary(tool)
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

  async removeTool(toolName: string): Promise<void> {
    const binDir = application.getPath('cherry.bin')
    for (const ext of isWin ? ['.exe', '.cmd'] : ['']) {
      const binPath = path.join(binDir, `${toolName}${ext}`)
      if (fs.existsSync(binPath)) {
        fs.unlinkSync(binPath)
      }
    }

    return this.withStateLock(async () => {
      const state = this.loadState()
      if (!state.tools[toolName]) return
      delete state.tools[toolName]
      state.updatedAt = new Date().toISOString()
      this.saveState(state)
    })
  }
}
