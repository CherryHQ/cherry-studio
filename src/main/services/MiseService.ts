import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { MiseTool } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'

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

@Injectable('MiseService')
@ServicePhase(Phase.Background)
export class MiseService extends BaseService {
  private miseBin: string | null = null

  protected async onInit() {
    this.registerIpcHandlers()
    this.extractBundledBinary()
    this.miseBin = this.findMiseBin()
    if (!this.miseBin) {
      logger.warn('mise binary not found, tool management disabled')
      return
    }
    logger.info('mise binary found', { path: this.miseBin })

    const tools = application.get('PreferenceService').get('feature.mise.tools')
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
      return this.installTool(tool)
    })

    this.ipcHandle(IpcChannel.Mise_RemoveTool, async (_event, toolName: string) => {
      return this.removeTool(toolName)
    })

    this.ipcHandle(IpcChannel.Mise_GetState, async () => {
      return this.loadState()
    })
  }

  private extractBundledBinary(): void {
    const platformKey = `${process.platform}-${process.arch}`
    const binaryName = isWin ? 'mise.exe' : 'mise'
    const bundled = path.join(application.getPath('app.root.resources.binaries'), platformKey, binaryName)

    if (!fs.existsSync(bundled)) {
      return
    }

    const binDir = application.getPath('cherry.bin')
    fs.mkdirSync(binDir, { recursive: true })
    const dest = path.join(binDir, binaryName)

    if (fs.existsSync(dest)) {
      return
    }

    fs.copyFileSync(bundled, dest)
    if (!isWin) {
      fs.chmodSync(dest, 0o755)
    }
    logger.info('Extracted bundled mise binary', { dest })
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

  private getIsolatedEnv(): Record<string, string> {
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
    const env = this.getIsolatedEnv()
    return execFileAsync(this.miseBin, args, { cwd, env, timeout: 120_000 })
  }

  private async installBinary(tool: MiseTool): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-mise-'))
    try {
      const version = tool.version || 'latest'
      const tomlContent = `[tools]\n"${tool.tool}" = "${version}"\n`
      fs.writeFileSync(path.join(tmpDir, 'mise.toml'), tomlContent)

      await this.runMise(['trust', tmpDir], tmpDir)
      await this.runMise(['install', tool.tool], tmpDir)

      const { stdout: srcPath } = await this.runMise(['which', tool.name], tmpDir)
      const trimmedPath = srcPath.trim()
      if (!trimmedPath) {
        throw new Error(`mise which ${tool.name} returned empty path`)
      }

      const { stdout: versionOut } = await this.runMise(['which', tool.name, '--version'], tmpDir)
      const installedVersion = versionOut.trim()

      const binaryName = isWin ? `${tool.name}.exe` : tool.name
      const binDir = application.getPath('cherry.bin')
      fs.mkdirSync(binDir, { recursive: true })
      const dstPath = path.join(binDir, binaryName)

      fs.copyFileSync(trimmedPath, dstPath)
      if (!isWin) {
        fs.chmodSync(dstPath, 0o755)
      }

      return installedVersion
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  private loadState(): MiseState {
    const statePath = application.getPath('feature.mise.state_file')
    try {
      const data = fs.readFileSync(statePath, 'utf-8')
      return JSON.parse(data)
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
  }

  async reconcile(tools: MiseTool[]): Promise<ReconcileResult> {
    if (!this.miseBin) {
      return { installed: [], failed: [{ name: '*', error: 'mise binary not available' }], skipped: [] }
    }

    const state = this.loadState()
    const result: ReconcileResult = { installed: [], failed: [], skipped: [] }

    for (const tool of tools) {
      const existing = state.tools[tool.name]
      if (existing && tool.version && existing.version === tool.version) {
        logger.info('Tool already at target version, skipping', { name: tool.name, version: tool.version })
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
  }

  async installTool(tool: MiseTool): Promise<{ version: string }> {
    if (!this.miseBin) {
      throw new Error('mise binary not available')
    }

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
  }

  async removeTool(toolName: string): Promise<void> {
    const binaryName = isWin ? `${toolName}.exe` : toolName
    const binPath = path.join(application.getPath('cherry.bin'), binaryName)
    if (fs.existsSync(binPath)) {
      fs.unlinkSync(binPath)
    }

    const state = this.loadState()
    delete state.tools[toolName]
    state.updatedAt = new Date().toISOString()
    this.saveState(state)
  }
}
