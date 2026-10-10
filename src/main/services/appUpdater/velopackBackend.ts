import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, open, unlink } from 'node:fs/promises'
import path from 'node:path'

import { eq, valid } from 'semver'
import { HttpSource, UpdateManager, type UpdateInfo, type VelopackAsset, type VelopackLocatorConfig } from 'velopack'

import type { AppEdition } from '@shared/types/appEdition'
import type { SupportedPlatform } from '@shared/types/command'

export function getVelopackChannel(platform: SupportedPlatform, arch: string, edition: AppEdition): string {
  if (arch !== 'x64' && arch !== 'arm64') throw new Error('UNSUPPORTED_INSTALL')
  const os = { win32: 'win', darwin: 'osx', linux: 'linux' }[platform]
  if (!os) throw new Error('UNSUPPORTED_INSTALL')
  return `${os}-${arch}-${edition}`
}

export function getVelopackFeedUrl(version: string, downloadUrls: readonly URL[]): string {
  if (!valid(version) || downloadUrls.length === 0) throw new Error('INVALID_PACKAGE')
  const feeds = downloadUrls.map((url) => {
    const prefix = `/CherryHQ/cherry-studio/releases/download/v${encodeURIComponent(version)}/`
    if (
      url.protocol !== 'https:' ||
      !['github.com', 'gitcode.com'].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(prefix) ||
      !url.pathname.slice(prefix.length) ||
      url.pathname.slice(prefix.length).includes('/')
    )
      throw new Error('INVALID_PACKAGE')
    return `${url.origin}${prefix}`
  })
  if (feeds.some((feed) => feed !== feeds[0])) throw new Error('INVALID_PACKAGE')
  return feeds[0]
}

export function validateAsset(asset: VelopackAsset, version: string, packageId: string): void {
  if (
    asset.PackageId !== packageId ||
    asset.Version !== version ||
    asset.Type !== 'Full' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*-full\.nupkg$/.test(asset.FileName) ||
    !/^[a-fA-F0-9]{64}$/.test(asset.SHA256) ||
    !Number.isSafeInteger(asset.Size) ||
    asset.Size <= 0
  )
    throw new Error('INVALID_PACKAGE')
}

async function inspectPackage(
  packagesDir: string,
  asset: VelopackAsset,
  expectedSize?: number
): Promise<VelopackAsset> {
  validateAsset(asset, asset.Version, asset.PackageId)
  const filename = path.join(packagesDir, asset.FileName)
  const entry = await lstat(filename)
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('INVALID_PACKAGE')
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.size <= 0 ||
      (expectedSize !== undefined && stat.size !== expectedSize) ||
      stat.ino !== entry.ino ||
      stat.dev !== entry.dev
    ) {
      throw new Error('INVALID_PACKAGE')
    }
    const hash = createHash('sha256')
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk)
    const after = await file.stat()
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
      throw new Error('CHECKSUM_MISMATCH')
    }
    return { ...asset, Size: stat.size, SHA256: hash.digest('hex') }
  } finally {
    await file.close()
  }
}

export async function verifyPackage(packagesDir: string, asset: VelopackAsset): Promise<void> {
  const actual = await inspectPackage(packagesDir, asset, asset.Size)
  if (actual.SHA256 !== asset.SHA256.toLowerCase()) throw new Error('CHECKSUM_MISMATCH')
}

export class VelopackBackend {
  private manager: UpdateManager | null = null
  private target: UpdateInfo | null = null
  private preparedAsset: VelopackAsset | null = null

  constructor(
    private readonly locator: VelopackLocatorConfig,
    private readonly edition: AppEdition,
    private readonly channel: string,
    private readonly currentVersion: string
  ) {}

  async resolve(version: string, downloadUrls: readonly URL[]): Promise<void> {
    const feedUrl = getVelopackFeedUrl(version, downloadUrls)
    await access(this.locator.PackagesDir, constants.W_OK)
    const manager = new UpdateManager(
      new HttpSource(feedUrl, {
        TimeoutMilliseconds: 60_000
      }),
      { ExplicitChannel: this.channel, AllowVersionDowngrade: false, MaximumDeltasBeforeFallback: 10 },
      this.locator
    )
    const packageId = `CherryStudio-${this.edition}`
    if (manager.getAppId() !== packageId || !eq(manager.getCurrentVersion(), this.currentVersion)) {
      throw new Error('UNSUPPORTED_INSTALL')
    }
    const target = await manager.checkForUpdatesAsync()
    if (!target || target.IsDowngrade) throw new Error('INVALID_PACKAGE')
    validateAsset(target.TargetFullRelease, version, packageId)
    if (!target.TargetFullRelease.FileName.endsWith(`-${this.channel}-full.nupkg`)) throw new Error('INVALID_PACKAGE')
    this.manager = manager
    this.target = target
  }

  async prepare(progress: (percent: number) => void): Promise<void> {
    if (!this.manager || !this.target) throw new Error('STALE_CANDIDATE')
    this.preparedAsset = null
    const asset = this.target.TargetFullRelease
    const filename = path.join(this.locator.PackagesDir, asset.FileName)
    try {
      await verifyPackage(this.locator.PackagesDir, asset)
      this.preparedAsset = asset
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await unlink(filename)
    }
    // A pending reconstructed target cannot also remain the base after its removal.
    if (this.target.BaseRelease?.FileName === asset.FileName) {
      this.target = { ...this.target, BaseRelease: undefined, DeltasToTarget: [] }
    }
    try {
      await this.manager.downloadUpdateAsync(this.target, progress)
      if (this.target.DeltasToTarget.length > 0 && this.target.BaseRelease) {
        // SDK validates delta inputs and reconstruction; ZIP bytes need not match the published full ZIP.
        this.preparedAsset = await inspectPackage(this.locator.PackagesDir, asset)
      } else {
        await verifyPackage(this.locator.PackagesDir, asset)
        this.preparedAsset = asset
      }
    } catch (error) {
      await unlink(filename).catch(() => {})
      throw error
    }
  }

  async verify(): Promise<void> {
    if (!this.preparedAsset) throw new Error('STALE_CANDIDATE')
    await verifyPackage(this.locator.PackagesDir, this.preparedAsset)
  }

  createHandoff(): () => void {
    const manager = this.manager
    const target = this.target
    if (!manager || !target || !this.preparedAsset) throw new Error('STALE_CANDIDATE')
    let launched = false
    return () => {
      if (launched) throw new Error('HANDOFF_UNKNOWN')
      launched = true
      manager.waitExitThenApplyUpdate(target, false, true)
    }
  }
}
