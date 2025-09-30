import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { app, ipcMain } from 'electron'
import { ChildProcess, spawn, spawnSync } from 'node:child_process'
import fse from 'fs-extra'
import path from 'node:path'
import crypto from 'node:crypto'
import StreamZip from 'node-stream-zip'

const logger = loggerService.withContext('NodeEmbedService')

export type NodeEmbedStatus = {
  running: boolean
  pid?: number
  cwd?: string
  command?: string
  appId?: string
  name?: string
  entry?: string
}

export type InstalledNodeApp = {
  id: string
  name: string
  version?: string
  dir: string
  entry: string // relative to dir
  createdAt: number
}

function toBool(value: any, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') return defaultValue
  const str = String(value).toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(str)
}

export class NodeEmbedService {
  private child?: ChildProcess
  private starting = false
  private runningInstalledApp?: InstalledNodeApp

  getConfig() {
    return {
      enabled: toBool(process.env.CHS_NODE_EMBED_ENABLED, false),
      cwd: process.env.CHS_NODE_EMBED_CWD || '',
      command: process.env.CHS_NODE_EMBED_CMD || '',
      shell: toBool(process.env.CHS_NODE_EMBED_SHELL, true),
      killTimeoutMs: Number(process.env.CHS_NODE_EMBED_KILL_TIMEOUT_MS || 8000)
    }
  }

  isRunning(): boolean {
    return !!this.child && !this.child.killed
  }

  getStatus(): NodeEmbedStatus {
    const cfg = this.getConfig()
    return {
      running: this.isRunning(),
      pid: this.child?.pid,
      cwd: this.runningInstalledApp?.dir || cfg.cwd,
      command: cfg.command,
      appId: this.runningInstalledApp?.id,
      name: this.runningInstalledApp?.name,
      entry: this.runningInstalledApp?.entry
    }
  }

  async start(): Promise<void> {
    const cfg = this.getConfig()
    if (!cfg.command || !cfg.cwd) {
      logger.warn('Node embed config is incomplete. Set CHS_NODE_EMBED_CMD and CHS_NODE_EMBED_CWD.')
      return
    }
    if (this.isRunning() || this.starting) return
    this.starting = true
    try {
      logger.info(`Starting embedded Node.js project: cwd=${cfg.cwd} cmd="${cfg.command}"`)
      const child = spawn(cfg.command, {
        cwd: cfg.cwd,
        env: { ...process.env },
        shell: cfg.shell,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.child = child

      child.stdout?.on('data', (data: Buffer) => {
        logger.info(`[stdout] ${data.toString().trimEnd()}`)
      })
      child.stderr?.on('data', (data: Buffer) => {
        logger.warn(`[stderr] ${data.toString().trimEnd()}`)
      })
      child.on('exit', (code, signal) => {
        logger.info(`Embedded Node.js process exited code=${code} signal=${signal}`)
        this.child = undefined
      })
      child.on('error', (err) => {
        logger.error('Embedded Node.js process error:', err)
      })
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<void> {
    const cfg = this.getConfig()
    if (!this.child || this.child.killed) return
    const pid = this.child.pid
    logger.info(`Stopping embedded Node.js project pid=${pid}`)
    try {
      if (process.platform === 'win32' && pid) {
        // taskkill to kill process tree
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        this.child.kill('SIGTERM')
      }
      // wait up to killTimeoutMs for exit
      const timeout = cfg.killTimeoutMs
      await new Promise<void>((resolve) => setTimeout(resolve, timeout))
      if (this.child && !this.child.killed) {
        this.child.kill('SIGKILL')
      }
    } catch (err) {
      logger.warn('Failed to stop embedded Node.js process gracefully:', err as Error)
    } finally {
      this.child = undefined
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  // ---------- Installed App Management (zip uploads) ----------
  private getRoot(): string {
    return path.join(app.getPath('userData'), 'node-embed')
  }
  private getAppsDir(): string {
    return path.join(this.getRoot(), 'apps')
  }
  private getManifestPath(dir: string): string {
    return path.join(dir, 'cherry-node.json')
  }
  private async ensureDirs() {
    await fse.ensureDir(this.getAppsDir())
  }
  private async detectEntry(dir: string): Promise<{ entry: string; name: string; version?: string }> {
    // 1) custom manifest
    const custom = this.getManifestPath(dir)
    if (await fse.pathExists(custom)) {
      const data = await fse.readJSON(custom).catch(() => null)
      if (data?.entry) {
        const abs = path.isAbsolute(data.entry) ? data.entry : path.join(dir, data.entry)
        if (await fse.pathExists(abs)) {
          return { entry: abs, name: data.name || path.basename(dir), version: data.version }
        }
      }
    }

    // 2) package.json (main or bin)
    const pkgPath = path.join(dir, 'package.json')
    if (await fse.pathExists(pkgPath)) {
      const pkg = await fse.readJSON(pkgPath).catch(() => null)
      if (pkg) {
        // main
        if (pkg.main) {
          const mainPath = path.join(dir, pkg.main)
          if (await fse.pathExists(mainPath)) {
            return { entry: mainPath, name: pkg.name || path.basename(dir), version: pkg.version }
          }
        }
        // bin (string or object)
        if (pkg.bin) {
          if (typeof pkg.bin === 'string') {
            const binPath = path.join(dir, pkg.bin)
            if (await fse.pathExists(binPath)) {
              return { entry: binPath, name: pkg.name || path.basename(dir), version: pkg.version }
            }
          } else if (typeof pkg.bin === 'object') {
            for (const key of Object.keys(pkg.bin)) {
              const p = path.join(dir, pkg.bin[key])
              if (await fse.pathExists(p)) {
                return { entry: p, name: key || pkg.name || path.basename(dir), version: pkg.version }
              }
            }
          }
        }
      }
    }

    // 3) common defaults (dirs × names × exts)
    const dirs = ['', 'dist', 'build', 'out']
    const names = ['index', 'server', 'main', 'app', 'api/index', 'backend/index']
    const exts = ['.js', '.cjs', '.mjs']
    for (const d of dirs) {
      for (const n of names) {
        for (const e of exts) {
          const rel = d ? path.join(d, n + e) : n + e
          const full = path.join(dir, rel)
          if (await fse.pathExists(full)) {
            return { entry: full, name: path.basename(dir) }
          }
        }
      }
    }

    // 4) shallow scan dist/build/out for first index.* file
    for (const d of ['dist', 'build', 'out']) {
      const base = path.join(dir, d)
      if (await fse.pathExists(base)) {
        const items = await fse.readdir(base).catch(() => [])
        for (const it of items) {
          const p = path.join(base, it)
          const stat = await fse.stat(p)
          if (stat.isFile() && /^index\.(m?c?js)$/i.test(it)) {
            return { entry: p, name: path.basename(dir) }
          }
          if (stat.isDirectory()) {
            const nested = await fse.readdir(p).catch(() => [])
            for (const fn of nested) {
              const np = path.join(p, fn)
              const st = await fse.stat(np)
              if (st.isFile() && /^(index|server|main)\.(m?c?js)$/i.test(fn)) {
                return { entry: np, name: path.basename(dir) }
              }
            }
          }
        }
      }
    }

    throw new Error('Cannot detect entry file. Provide cherry-node.json with {"entry":"..."} or specify an entry path during installation.')
  }
  private generateId(prefix = 'app'): string {
    return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  }
  async installFromZip(zipPath: string, override?: { entry?: string; name?: string }): Promise<InstalledNodeApp> {
    await this.ensureDirs()
    const appId = this.generateId()
    const destDir = path.join(this.getAppsDir(), appId)
    await fse.ensureDir(destDir)
    logger.info(`Installing Node app from zip: ${zipPath} -> ${destDir}`)
    const zip = new (StreamZip as any).async({ file: zipPath }) as StreamZip.AsyncZip
    try {
      await zip.extract(null, destDir)
    } finally {
      await zip.close()
    }
    // if single top-level folder => move up
    const entries = await fse.readdir(destDir)
    if (entries.length === 1) {
      const only = path.join(destDir, entries[0])
      if ((await fse.stat(only)).isDirectory()) {
        const temp = path.join(this.getAppsDir(), `${appId}-tmp`)
        await fse.move(only, temp, { overwrite: true })
        await fse.remove(destDir)
        await fse.move(temp, destDir)
      }
    }
    let info = await this.detectEntry(destDir).catch(() => null as any)
    if (!info && override?.entry) {
      const overrideAbs = path.isAbsolute(override.entry)
        ? override.entry
        : path.join(destDir, override.entry)
      if (await fse.pathExists(overrideAbs)) {
        info = { entry: overrideAbs, name: override?.name || path.basename(destDir) }
      }
    }
    if (!info) {
      throw new Error('Cannot detect entry file. Provide cherry-node.json with {"entry":"..."}.')
    }
    const manifest: InstalledNodeApp = {
      id: appId,
      name: override?.name || info.name,
      version: info.version,
      dir: destDir,
      entry: path.relative(destDir, info.entry),
      createdAt: Date.now()
    }
    await fse.writeJSON(this.getManifestPath(destDir), manifest, { spaces: 2 })
    return manifest
  }
  async listInstalled(): Promise<InstalledNodeApp[]> {
    await this.ensureDirs()
    const appsDir = this.getAppsDir()
    const sub = await fse.readdir(appsDir).catch(() => [])
    const result: InstalledNodeApp[] = []
    for (const id of sub) {
      const dir = path.join(appsDir, id)
      const manifest = this.getManifestPath(dir)
      if (await fse.pathExists(manifest)) {
        const m = await fse.readJSON(manifest).catch(() => null)
        if (m?.id && m?.entry) result.push({ ...m, dir })
      }
    }
    return result
  }
  async remove(appId: string): Promise<void> {
    if (this.runningInstalledApp?.id === appId) throw new Error('App is running; stop first.')
    await this.ensureDirs()
    await fse.remove(path.join(this.getAppsDir(), appId))
  }
  private async spawnInstalled(app: InstalledNodeApp, env?: Record<string, string>) {
    const entryAbs = path.isAbsolute(app.entry) ? app.entry : path.join(app.dir, app.entry)
    logger.info(`Starting Node app ${app.name} (${app.id}) -> ${entryAbs}`)
    const child = spawn(process.execPath, [entryAbs], {
      cwd: app.dir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    this.runningInstalledApp = app
    child.stdout?.on('data', (d) => logger.info(`[${app.name}] ${d.toString().trimEnd()}`))
    child.stderr?.on('data', (d) => logger.warn(`[${app.name}] ${d.toString().trimEnd()}`))
    child.on('exit', (code, signal) => {
      logger.info(`Node app exited (${app.id}) code=${code} signal=${signal}`)
      this.child = undefined
      this.runningInstalledApp = undefined
    })
    child.on('error', (err) => logger.error('Node app process error:', err))
  }
  async startInstalled(appId: string, env?: Record<string, string>) {
    const apps = await this.listInstalled()
    const app = apps.find((a) => a.id === appId)
    if (!app) throw new Error(`App not found: ${appId}`)
    await this.spawnInstalled(app, env)
  }
  async restartInstalled(appId: string, env?: Record<string, string>) {
    await this.stop()
    await this.startInstalled(appId, env)
  }

  registerIpcHandlers() {
    ipcMain.handle(IpcChannel.NodeEmbed_Install as any, async (_evt, zipPath: string, override?: { entry?: string; name?: string }) => {
      try {
        const app = await this.installFromZip(zipPath, override)
        return { success: true, app }
      } catch (e: any) {
        logger.error('Install failed:', e)
        return { success: false, error: e?.message || 'unknown' }
      }
    })
    ipcMain.handle(IpcChannel.NodeEmbed_List as any, async () => {
      try {
        const apps = await this.listInstalled()
        return { success: true, apps }
      } catch (e: any) {
        return { success: false, error: e?.message || 'unknown' }
      }
    })
    ipcMain.handle(IpcChannel.NodeEmbed_Remove as any, async (_evt, appId: string) => {
      try {
        await this.remove(appId)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e?.message || 'unknown' }
      }
    })
    ipcMain.handle(IpcChannel.NodeEmbed_Start, async (_evt, appId?: string, env?: Record<string, string>) => {
      try {
        if (appId) {
          await this.startInstalled(appId, env)
        } else {
          await this.start()
        }
        return { success: true, status: this.getStatus() }
      } catch (e: any) {
        return { success: false, error: e?.message || 'unknown' }
      }
    })
    ipcMain.handle(IpcChannel.NodeEmbed_Stop, async () => {
      try {
        await this.stop()
        return { success: true, status: this.getStatus() }
      } catch (e: any) {
        return { success: false, error: e?.message || 'unknown' }
      }
    })
    ipcMain.handle(IpcChannel.NodeEmbed_Restart, async (_evt, appId?: string, env?: Record<string, string>) => {
      try {
        if (appId) {
          await this.restartInstalled(appId, env)
        } else {
          await this.restart()
        }
        return { success: true, status: this.getStatus() }
      } catch (e: any) {
        return { success: false, error: e?.message || 'unknown' }
      }
    })
    ipcMain.handle(IpcChannel.NodeEmbed_GetStatus, () => this.getStatus())
  }
}

export const nodeEmbedService = new NodeEmbedService()

// Hook app lifecycle to stop child on quit
app.on('before-quit', async () => {
  try {
    await nodeEmbedService.stop()
  } catch {}
})
