import { ChildProcess, spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import net from 'node:net'
import path from 'node:path'

import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { app, ipcMain } from 'electron'
import fse from 'fs-extra'
import StreamZip from 'node-stream-zip'

import { getFilesDir } from '../utils/file'
import storeSyncService from './StoreSyncService'

const logger = loggerService.withContext('NodeEmbedService')

// No default logo here. Leave empty to use renderer's default ApplicationLogo for custom minapps.

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
  args?: string[]
  env?: Record<string, string>
  healthCheck?: HealthCheckConfig
  ui?: UiConfig
}

type HealthCheckConfig = {
  type?: 'http' | 'tcp'
  // http options
  url?: string // full URL, takes precedence
  path?: string // used with portFromEnv
  portFromEnv?: string // env var name that holds the port, e.g. "PORT"
  timeoutMs?: number // per-attempt timeout
  intervalMs?: number // interval between attempts
  retries?: number // number of attempts
}

type UiConfig = {
  url?: string
  path?: string
  portFromEnv?: string
  name?: string
  logo?: string
}

type CherryNodeAppManifest = {
  name?: string
  version?: string
  entry?: string
  args?: string[]
  env?: Record<string, string>
  healthCheck?: HealthCheckConfig
  ui?: UiConfig
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
  // App-provided manifest inside the bundle
  private getAppManifestPath(dir: string): string {
    return path.join(dir, 'cherry-node.json')
  }
  // Installed metadata manifest managed by Cherry Studio
  private getInstallManifestPath(dir: string): string {
    return path.join(dir, 'cherry-node.install.json')
  }
  private async ensureDirs() {
    await fse.ensureDir(this.getAppsDir())
  }
  private async detectEntry(
    dir: string
  ): Promise<{
    entry: string
    name: string
    version?: string
    args?: string[]
    env?: Record<string, string>
    healthCheck?: HealthCheckConfig
    ui?: UiConfig
  }> {
    // 1) custom manifest
    const custom = this.getAppManifestPath(dir)
    if (await fse.pathExists(custom)) {
      const data = (await fse.readJSON(custom).catch(() => null)) as CherryNodeAppManifest | null
      if (data?.entry) {
        const abs = path.isAbsolute(data.entry) ? data.entry : path.join(dir, data.entry)
        if (await fse.pathExists(abs)) {
          return {
            entry: abs,
            name: data.name || path.basename(dir),
            version: data.version,
            args: data.args,
            env: data.env,
            healthCheck: data.healthCheck,
            ui: data.ui
          }
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

    throw new Error(
      'Cannot detect entry file. Provide cherry-node.json with {"entry":"..."} or specify an entry path during installation.'
    )
  }
  private generateId(prefix = 'app'): string {
    return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  }
  async installFromZip(
    zipPath: string,
    override?: {
      entry?: string
      name?: string
      version?: string
      args?: string[]
      env?: Record<string, string>
      healthCheck?: HealthCheckConfig
      ui?: UiConfig
    }
  ): Promise<InstalledNodeApp> {
    await this.ensureDirs()
    const appId = this.generateId()
    const destDir = path.join(this.getAppsDir(), appId)
    await fse.ensureDir(destDir)
    logger.info(`Installing Node app from zip: ${zipPath} -> ${destDir}`)
    const zip = new (StreamZip as any).async({ file: zipPath }) as any
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
      const overrideAbs = path.isAbsolute(override.entry) ? override.entry : path.join(destDir, override.entry)
      if (await fse.pathExists(overrideAbs)) {
        info = { entry: overrideAbs, name: override?.name || path.basename(destDir) }
      }
    }
    if (!info) {
      throw new Error(
        'Cannot detect entry file. Provide cherry-node.json with {"entry":"..."} or specify an entry path during installation.'
      )
    }
    // Merge env from detected manifest and override
    const mergedEnv: Record<string, string> = {}
    if (info.env) Object.assign(mergedEnv, info.env)
    if (override?.env) Object.assign(mergedEnv, override.env)
    // Pre-allocate a port at install-time if we can infer the env key and no value set
    try {
      const portKey =
        override?.ui?.portFromEnv ||
        info.ui?.portFromEnv ||
        override?.healthCheck?.portFromEnv ||
        info.healthCheck?.portFromEnv
      if (portKey && !mergedEnv[portKey]) {
        const p = await this.findFreePort()
        mergedEnv[portKey] = String(p)
        logger.info(`Allocated install-time port ${p} for ${override?.name || info.name} via env ${portKey}`)
      }
    } catch (e) {
      logger.warn('Install-time port allocation failed:', e as Error)
    }

    const manifest: InstalledNodeApp = {
      id: appId,
      name: override?.name || info.name,
      version: override?.version || info.version,
      dir: destDir,
      entry: path.relative(destDir, info.entry),
      createdAt: Date.now(),
      args: override?.args || info.args,
      env: mergedEnv,
      healthCheck: override?.healthCheck || info.healthCheck,
      ui: override?.ui || info.ui
    }
    // Write installed manifest to separate file
    await fse.writeJSON(this.getInstallManifestPath(destDir), manifest, { spaces: 2 })
    // Auto-register mini app on install (upload)
    try {
      await this.autoRegisterMiniApp(manifest, manifest.env || {})
    } catch (e) {
      logger.warn(`Auto-register mini app failed during install for ${manifest.name}:`, e as Error)
    }
    return manifest
  }
  async listInstalled(): Promise<InstalledNodeApp[]> {
    await this.ensureDirs()
    const appsDir = this.getAppsDir()
    const sub = await fse.readdir(appsDir).catch(() => [])
    const result: InstalledNodeApp[] = []
    for (const id of sub) {
      const dir = path.join(appsDir, id)
      const installManifest = this.getInstallManifestPath(dir)
      let m: InstalledNodeApp | null = null
      if (await fse.pathExists(installManifest)) {
        m = (await fse.readJSON(installManifest).catch(() => null)) as InstalledNodeApp | null
      } else {
        // backward compatibility: read old combined manifest if present
        const legacy = this.getAppManifestPath(dir)
        if (await fse.pathExists(legacy)) {
          const j = (await fse.readJSON(legacy).catch(() => null)) as any
          if (j?.id && j?.entry) {
            m = { ...j, dir } as InstalledNodeApp
          }
        }
      }
      if (m?.id && m?.entry) result.push({ ...m, dir })
    }
    return result
  }
  async remove(appId: string): Promise<void> {
    if (this.runningInstalledApp?.id === appId) throw new Error('App is running; stop first.')
    await this.ensureDirs()
    const dir = path.join(this.getAppsDir(), appId)
    // try auto-unregister before removing files
    try {
      const manifestPath = this.getInstallManifestPath(dir)
      if (await fse.pathExists(manifestPath)) {
        const m = (await fse.readJSON(manifestPath).catch(() => null)) as InstalledNodeApp | null
        if (m) await this.autoUnregisterMiniApp(m)
      }
    } catch (e) {
      logger.warn(`Failed to auto-unregister mini app for ${appId} during removal`, e as Error)
    }
    await fse.remove(dir)
  }
  private async findFreePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      const server = net.createServer()
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          const port = address.port
          server.close(() => resolve(port))
        } else {
          server.close(() => reject(new Error('Failed to acquire a free port')))
        }
      })
    })
  }

  private async spawnInstalled(app: InstalledNodeApp, env?: Record<string, string>) {
    const entryAbs = path.isAbsolute(app.entry) ? app.entry : path.join(app.dir, app.entry)
    const mergedEnv: Record<string, string> = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    if (app.env) Object.assign(mergedEnv, app.env)
    if (env) Object.assign(mergedEnv, env)

    // Allocate port if requested by healthCheck and not provided
    const hc = app.healthCheck
    if (hc?.type === 'http' && hc.portFromEnv) {
      const key = hc.portFromEnv
      if (!mergedEnv[key]) {
        try {
          const p = await this.findFreePort()
          mergedEnv[key] = String(p)
          logger.info(`Allocated port ${p} for ${app.name} via env ${key}`)
        } catch (e) {
          logger.warn(`Failed to allocate port for ${app.name}:`, e as Error)
        }
      }
    }

    const nodeArgs = [entryAbs, ...(app.args || [])]
    logger.info(`Starting Node app ${app.name} (${app.id}) -> ${entryAbs}`)
    const child = spawn(process.execPath, nodeArgs, {
      cwd: app.dir,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    this.runningInstalledApp = app
    let miniAppUrlRegistered = false
    child.stdout?.on('data', (d) => {
      const text = d.toString()
      logger.info(`[${app.name}] ${text.trimEnd()}`)
      if (miniAppUrlRegistered) return
      // Try to extract a local URL like http://localhost:3000 or http://127.0.0.1:3001
      const m = text.match(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):([0-9]{2,5})(\/[\w\-./?=&%]*)?/i)
      if (m) {
        const host =
          m[1].toLowerCase() === '0.0.0.0' ? '127.0.0.1' : m[1].toLowerCase() === 'localhost' ? '127.0.0.1' : m[1]
        const port = m[2]
        const pathSuffix = m[3] && m[3].length > 0 ? m[3] : '/'
        const url = `http://${host}:${port}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`
        this.upsertMiniAppEntry(app, url).catch((e) =>
          logger.warn(`Mini app upsert failed from logs for ${app.name}:`, e as Error)
        )
        miniAppUrlRegistered = true
      }
    })
    child.stderr?.on('data', (d) => logger.warn(`[${app.name}] ${d.toString().trimEnd()}`))
    child.on('exit', (code, signal) => {
      logger.info(`Node app exited (${app.id}) code=${code} signal=${signal}`)
      this.child = undefined
      this.runningInstalledApp = undefined
    })
    child.on('error', (err) => logger.error('Node app process error:', err))

    // fire-and-forget health check only
    this.performHealthCheck(app, mergedEnv).catch((e) => logger.warn(`Health check error for ${app.name}:`, e as Error))

    // Ensure existing mini app URL is updated if it was a placeholder or changed
    this.updateMiniAppUrlIfExists(app, mergedEnv).catch((e) =>
      logger.warn(`Update mini app url failed for ${app.name}:`, e as Error)
    )
  }

  private async performHealthCheck(app: InstalledNodeApp, envObj: Record<string, string>) {
    const hc = app.healthCheck
    if (!hc) return
    const type = hc.type || 'http'
    const timeoutMs = hc.timeoutMs ?? 3000
    const intervalMs = hc.intervalMs ?? 500
    const retries = hc.retries ?? 10

    const url = (() => {
      if (hc.url) return hc.url
      if (type === 'http' && hc.path && hc.portFromEnv) {
        const port = envObj[hc.portFromEnv]
        if (port) return `http://127.0.0.1:${port}${hc.path.startsWith('/') ? hc.path : `/${hc.path}`}`
      }
      return undefined
    })()

    if (type === 'http' && url) {
      logger.info(`Health check (http) for ${app.name}: ${url}`)
      for (let i = 0; i < retries; i++) {
        try {
          const controller = new AbortController()
          const to = setTimeout(() => controller.abort(), timeoutMs)
          const res = await fetch(url, { signal: controller.signal })
          clearTimeout(to)
          if (res.ok) {
            logger.info(`Health check passed for ${app.name}`)
            return
          }
        } catch (e) {
          // Ignore health probe errors and retry
        }
        await new Promise((r) => setTimeout(r, intervalMs))
      }
      logger.warn(`Health check did not pass for ${app.name} after ${retries} attempts`)
    }
  }

  private async autoRegisterMiniApp(app: InstalledNodeApp, envObj: Record<string, string>): Promise<void> {
    const id = `node-embed-${app.id}`

    const buildUrl = (): string | undefined => {
      const ui = app.ui
      if (ui?.url) return ui.url
      const getPortFromEnv = (key?: string) => (key ? envObj[key] : undefined)
      const pickPort = () =>
        getPortFromEnv(ui?.portFromEnv) || getPortFromEnv(app.healthCheck?.portFromEnv) || envObj['PORT']
      const port = pickPort()
      if (!port) return undefined
      const p = ui?.path || '/'
      return `http://127.0.0.1:${port}${p.startsWith('/') ? p : `/${p}`}`
    }

    const url = buildUrl()
    if (!url) {
      logger.info(`No UI url detected for ${app.name}, skip mini app registration`)
      return
    }

    const name = app.ui?.name || app.name || 'Embedded App'
    const usedLogo = app.ui?.logo || ''

    const filePath = path.join(getFilesDir(), 'custom-minapps.json')
    let list: any[] = []
    try {
      if (await fse.pathExists(filePath)) {
        const text = await fse.readFile(filePath, 'utf8')
        list = JSON.parse(text)
      } else {
        await fse.ensureDir(path.dirname(filePath))
        list = []
      }
    } catch (e) {
      logger.warn('Failed to read custom-minapps.json, will recreate', e as Error)
      list = []
    }

    const existingIndex = list.findIndex((x) => x && x.id === id)
    const now = new Date().toISOString()
    const item = {
      id,
      name,
      url,
      logo: usedLogo,
      type: 'Custom',
      addTime: now
    }

    let changed = false
    if (existingIndex >= 0) {
      const prev = list[existingIndex]
      // update if url/name/logo changed
      if (prev.url !== url || prev.name !== name || prev.logo !== usedLogo) {
        list[existingIndex] = { ...prev, ...item }
        changed = true
      }
    } else {
      list.push(item)
      changed = true
      // broadcast add to current window(s)
      try {
        storeSyncService.syncToRenderer('minApps/addMinApp', item)
        // also try commonly used case-sensitive action name
        storeSyncService.syncToRenderer('minapps/addMinApp', item)
      } catch (e) {
        logger.warn('Failed to broadcast mini app add action', e as Error)
      }
    }

    if (changed) {
      try {
        await fse.writeFile(filePath, JSON.stringify(list, null, 2), 'utf8')
        logger.info(`Updated custom-minapps.json with ${id}`)
      } catch (e) {
        logger.warn('Failed to write custom-minapps.json', e as Error)
      }
    }
  }

  private async updateMiniAppUrlIfExists(app: InstalledNodeApp, envObj: Record<string, string>): Promise<void> {
    const id = `node-embed-${app.id}`
    const filePath = path.join(getFilesDir(), 'custom-minapps.json')
    if (!(await fse.pathExists(filePath))) return

    let list: any[]
    try {
      list = JSON.parse(await fse.readFile(filePath, 'utf8'))
    } catch (e) {
      // Ignore parse error, list stays empty
      return
    }
    const idx = Array.isArray(list) ? list.findIndex((x) => x && x.id === id) : -1
    if (idx < 0) return

    const buildUrl = (): string | undefined => {
      const ui = app.ui
      if (ui?.url) return ui.url
      const getPortFromEnv = (key?: string) => (key ? envObj[key] : undefined)
      const pickPort = () =>
        getPortFromEnv(ui?.portFromEnv) || getPortFromEnv(app.healthCheck?.portFromEnv) || envObj['PORT']
      const port = pickPort()
      if (!port) return undefined
      const p = ui?.path || '/'
      return `http://127.0.0.1:${port}${p.startsWith('/') ? p : `/${p}`}`
    }

    const url = buildUrl()
    if (!url) return

    const prev = list[idx]
    if (prev.url !== url) {
      list[idx] = { ...prev, url }
      try {
        await fse.writeFile(filePath, JSON.stringify(list, null, 2), 'utf8')
        logger.info(`Updated mini app url for ${app.name} -> ${url}`)
        // broadcast a minimal update (reuse add action for simplicity in UI)
        try {
          storeSyncService.syncToRenderer('minApps/addMinApp', list[idx])
          storeSyncService.syncToRenderer('minapps/addMinApp', list[idx])
        } catch (e) {
          // Ignore broadcast errors
        }
      } catch (e) {
        logger.warn('Failed to persist updated mini app url', e as Error)
      }
    }
  }

  private async readMiniAppList(filePath: string): Promise<any[]> {
    try {
      if (await fse.pathExists(filePath)) {
        const text = await fse.readFile(filePath, 'utf8')
        const list = JSON.parse(text)
        return Array.isArray(list) ? list : []
      }
    } catch (e) {
      // Ignore file read/JSON parse errors
    }
    return []
  }

  private async writeMiniAppList(filePath: string, list: any[]): Promise<void> {
    await fse.ensureDir(path.dirname(filePath))
    await fse.writeFile(filePath, JSON.stringify(list, null, 2), 'utf8')
  }

  private async upsertMiniAppEntry(app: InstalledNodeApp, url: string): Promise<void> {
    const id = `node-embed-${app.id}`
    const name = app.ui?.name || app.name || 'Embedded App'
    const logo = app.ui?.logo || ''
    // normalize host 0.0.0.0/localhost to 127.0.0.1
    try {
      const u = new URL(url)
      if (u.hostname === '0.0.0.0' || u.hostname === 'localhost') u.hostname = '127.0.0.1'
      if (!u.pathname) u.pathname = '/'
      url = u.toString()
    } catch (e) {
      // Ignore URL normalization errors
    }

    const filePath = path.join(getFilesDir(), 'custom-minapps.json')
    const list = await this.readMiniAppList(filePath)
    const now = new Date().toISOString()
    const idx = list.findIndex((x) => x && x.id === id)
    const item = { id, name, url, logo, type: 'Custom', addTime: now }
    let changed = false
    if (idx >= 0) {
      const prev = list[idx]
      if (prev.url !== url || prev.name !== name || prev.logo !== logo) {
        list[idx] = { ...prev, ...item }
        changed = true
      }
    } else {
      list.push(item)
      changed = true
    }

    if (changed) {
      try {
        await this.writeMiniAppList(filePath, list)
        logger.info(`Mini app upserted: ${name} -> ${url}`)
        try {
          storeSyncService.syncToRenderer('minApps/addMinApp', item)
          storeSyncService.syncToRenderer('minapps/addMinApp', item)
        } catch (e) {
          // Ignore broadcast errors
        }
      } catch (e) {
        logger.warn('Failed to persist mini app list on upsert', e as Error)
      }
    }
  }

  private async autoUnregisterMiniApp(app: InstalledNodeApp): Promise<void> {
    const id = `node-embed-${app.id}`
    const filePath = path.join(getFilesDir(), 'custom-minapps.json')

    let list: any[] = []
    try {
      if (await fse.pathExists(filePath)) {
        const text = await fse.readFile(filePath, 'utf8')
        list = JSON.parse(text)
      }
    } catch (e) {
      // If file is corrupted/non-json, treat as empty and rewrite
      list = []
    }

    const newList = Array.isArray(list) ? list.filter((x) => !(x && x.id === id)) : []
    const changed = JSON.stringify(list) !== JSON.stringify(newList)

    if (changed) {
      try {
        await fse.ensureDir(path.dirname(filePath))
        await fse.writeFile(filePath, JSON.stringify(newList, null, 2), 'utf8')
        logger.info(`Removed ${id} from custom-minapps.json`)
      } catch (e) {
        logger.warn('Failed to update custom-minapps.json on unregister', e as Error)
      }
    }

    // Broadcast removal to renderer stores (if reducer exists)
    try {
      storeSyncService.syncToRenderer('minApps/removeMinApp', id)
      storeSyncService.syncToRenderer('minapps/removeMinApp', id)
    } catch (e) {
      logger.warn('Failed to broadcast mini app remove action', e as Error)
    }
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
    ipcMain.handle(
      IpcChannel.NodeEmbed_Install as any,
      async (
        _evt,
        zipPath: string,
        override?: {
          entry?: string
          name?: string
          version?: string
          args?: string[]
          env?: Record<string, string>
          healthCheck?: HealthCheckConfig
          ui?: UiConfig
        }
      ) => {
        try {
          const app = await this.installFromZip(zipPath, override)
          return { success: true, app }
        } catch (e: any) {
          logger.error('Install failed:', e)
          return { success: false, error: e?.message || 'unknown' }
        }
      }
    )
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
  } catch (e) {
    // Ignore errors on shutdown
  }
})
