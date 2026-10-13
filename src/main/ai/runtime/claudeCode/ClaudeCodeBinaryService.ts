import { createHash } from 'node:crypto'
import { constants, createWriteStream, existsSync, readFileSync, statSync, accessSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

import { net } from 'electron'
import { valid as semverValid } from 'semver'
import { extract } from 'tar'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { regionService } from '@main/services/RegionService'
import type { ClaudeCodeBinaryStatus } from '@shared/ai/claudeCodeBinary'

import { claudeCodeBinaryManifest as manifest } from './binaryManifest'

const logger = loggerService.withContext('ClaudeCodeBinaryService')
const STALL_TIMEOUT_MS = 30_000

export function claudeBinaryTarget(platform: string, arch: string, glibc?: string): string {
  return `${platform}-${arch}${platform === 'linux' && !glibc ? '-musl' : ''}`
}

@Injectable('ClaudeCodeBinaryService')
@ServicePhase(Phase.WhenReady)
export class ClaudeCodeBinaryService extends BaseService {
  private readonly target = claudeBinaryTarget(
    process.platform,
    process.arch,
    process.platform === 'linux'
      ? (process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime
      : undefined
  )
  private status: ClaudeCodeBinaryStatus = { version: manifest.version, phase: 'missing', receivedBytes: 0 }
  private pending?: Promise<void>
  private controller?: AbortController

  private get installDir(): string {
    return path.join(application.getPath('feature.claude_code.binary'), manifest.version, this.target)
  }

  private get executable(): string {
    return path.join(this.installDir, process.platform === 'win32' ? 'claude.exe' : 'claude')
  }

  getStatus(): ClaudeCodeBinaryStatus {
    if (!this.pending && this.status.phase !== 'error') {
      this.status = { ...this.status, phase: this.isInstalled() ? 'ready' : 'missing' }
    }
    return { ...this.status }
  }

  private isInstalled(): boolean {
    try {
      const installed = JSON.parse(readFileSync(path.join(this.installDir, 'installed.json'), 'utf8'))
      const binary = statSync(this.executable)
      accessSync(this.executable, process.platform === 'win32' ? constants.R_OK : constants.X_OK)
      return (
        installed.integrity === manifest.packages[this.target]?.integrity &&
        binary.isFile() &&
        binary.size > 0 &&
        installed.size === binary.size
      )
    } catch {
      return false
    }
  }

  requireExecutable(): string {
    if (!this.isInstalled()) throw new Error(t('agent.session.claude.runtime_unavailable'))
    return this.executable
  }

  async ensureExecutable(): Promise<string> {
    this.ensure()
    await this.pending
    return this.requireExecutable()
  }

  ensure(retry = false): ClaudeCodeBinaryStatus {
    if (this.pending) return this.getStatus()
    const status = this.getStatus()
    if (status.phase === 'ready') {
      this.pending = this.cleanupOtherVersions().finally(() => {
        this.pending = undefined
      })
      return status
    }
    if (status.phase === 'error' && !retry) return status
    if (!manifest.packages[this.target]) {
      this.publish({ phase: 'error', error: 'unsupported', receivedBytes: 0 })
      return this.getStatus()
    }
    this.controller = new AbortController()
    this.publish({ phase: 'downloading', receivedBytes: 0 })
    this.pending = this.install(this.controller.signal)
      .catch((error) => {
        logger.warn('Claude Code binary installation failed', { error })
        const code = (error as NodeJS.ErrnoException).code
        this.publish({
          phase: 'error',
          receivedBytes: this.status.receivedBytes,
          error:
            error instanceof BinaryStorageError ||
            ['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO', 'ENOTDIR'].includes(code ?? '')
              ? 'storage'
              : error instanceof BinaryIntegrityError
                ? 'integrity'
                : this.status.phase === 'installing'
                  ? 'installation'
                  : 'network'
        })
      })
      .finally(() => {
        this.pending = undefined
        this.controller = undefined
      })
    return this.getStatus()
  }

  private publish(update: Omit<ClaudeCodeBinaryStatus, 'version'>): void {
    this.status = { version: manifest.version, ...update }
    application.get('IpcApiService').broadcast('ai.claude_code.binary.changed', { ...this.status })
  }

  private async install(signal: AbortSignal): Promise<void> {
    const root = application.getPath('feature.claude_code.binary')
    const staging = await mkdtemp(path.join(root, '.download-')).catch((error) => {
      throw new BinaryStorageError('Could not create runtime staging directory', { cause: error })
    })
    try {
      const pkg = manifest.packages[this.target]
      const china = await regionService.isInChina(signal)
      const registries = china
        ? ['https://registry.npmmirror.com', 'https://registry.npmjs.org']
        : ['https://registry.npmjs.org', 'https://registry.npmmirror.com']
      const tarball = path.join(staging, 'package.tgz')
      for (const [index, registry] of registries.entries()) {
        try {
          const basename = pkg.name.split('/').at(-1)
          await this.download(
            `${registry}/${pkg.name}/-/${basename}-${manifest.version}.tgz`,
            tarball,
            pkg.integrity,
            signal
          )
          break
        } catch (error) {
          signal.throwIfAborted()
          if (index === registries.length - 1) throw error
          logger.warn('Claude Code download source failed; trying fallback', { registry, error })
        }
      }
      signal.throwIfAborted()
      this.publish({
        phase: 'installing',
        receivedBytes: this.status.receivedBytes,
        totalBytes: this.status.totalBytes
      })
      const unpacked = path.join(staging, 'unpacked')
      await mkdir(unpacked)
      const filename = process.platform === 'win32' ? 'claude.exe' : 'claude'
      await extract({
        file: tarball,
        cwd: unpacked,
        strip: 1,
        filter: (entryPath, entry) =>
          'type' in entry && entry.type === 'File' && ['package/' + filename, 'package/LICENSE.md'].includes(entryPath)
      })
      const executable = path.join(unpacked, filename)
      const size = statSync(executable).size
      if (!size) throw new Error('Empty Claude binary')
      if (process.platform !== 'win32') await chmod(executable, 0o755)
      await writeFile(path.join(unpacked, 'installed.json'), JSON.stringify({ integrity: pkg.integrity, size }))
      signal.throwIfAborted()
      await mkdir(path.dirname(this.installDir), { recursive: true })
      if (existsSync(this.installDir)) await rm(this.installDir, { recursive: true, force: true })
      await rename(unpacked, this.installDir)
      this.publish({ phase: 'ready', receivedBytes: this.status.receivedBytes, totalBytes: this.status.totalBytes })
      await this.cleanupOtherVersions()
    } finally {
      await rm(staging, { recursive: true, force: true }).catch((error) => {
        logger.warn('Could not remove Claude Agent staging directory', { error })
      })
    }
  }

  private async cleanupOtherVersions(): Promise<void> {
    const root = application.getPath('feature.claude_code.binary')
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !semverValid(entry.name) || entry.name === manifest.version) continue
        try {
          await rm(path.join(root, entry.name), { recursive: true, force: true })
        } catch (error) {
          logger.warn('Could not remove unused Claude Code version', { version: entry.name, error })
        }
      }
    } catch (error) {
      logger.warn('Could not scan unused Claude Code versions', { error })
    }
  }

  private async download(url: string, destination: string, integrity: string, signal: AbortSignal): Promise<void> {
    const timeout = new AbortController()
    const combined = AbortSignal.any([signal, timeout.signal])
    let timer = setTimeout(() => timeout.abort(), STALL_TIMEOUT_MS)
    let receivedBytes = 0
    let lastPublished = 0
    this.publish({ phase: 'downloading', receivedBytes })
    try {
      const response = await net.fetch(url, { signal: combined })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const totalBytes = Number(response.headers.get('content-length')) || undefined
      const hash = createHash('sha512')
      const meter = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          clearTimeout(timer)
          timer = setTimeout(() => timeout.abort(), STALL_TIMEOUT_MS)
          receivedBytes += chunk.length
          hash.update(chunk)
          if (Date.now() - lastPublished >= 100) {
            this.publish({ phase: 'downloading', receivedBytes, totalBytes })
            lastPublished = Date.now()
          }
          callback(null, chunk)
        }
      })
      await pipeline(
        Readable.fromWeb(response.body as NodeWebReadableStream<Uint8Array>),
        meter,
        createWriteStream(destination),
        { signal: combined }
      )
      if (`sha512-${hash.digest('base64')}` !== integrity)
        throw new BinaryIntegrityError('Claude binary integrity mismatch')
      this.publish({ phase: 'downloading', receivedBytes, totalBytes })
    } finally {
      clearTimeout(timer)
    }
  }

  protected onAllReady(): void {
    this.ensure()
  }

  protected async onStop(): Promise<void> {
    this.controller?.abort()
    await this.pending
  }
}

class BinaryIntegrityError extends Error {}
class BinaryStorageError extends Error {}
