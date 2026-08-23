import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isLinux, isWin } from '@main/core/platform'
import { cleanupOtherArtifactVersions, ensureBundledFiles } from '@main/services/bundledArtifact'
import { toAsarUnpackedPath } from '@main/utils/asar'
import { bundledArtifactPlatformKey, readBundledArtifactManifest } from '@main/utils/bundledArtifactManifest'
import { app } from 'electron'

const logger = loggerService.withContext('ClaudeCodeBinaryService')
const require_ = createRequire(import.meta.url)

export function resolveInstalledClaudeExecutablePath(): string {
  const sdkRequire = createRequire(require_.resolve('@anthropic-ai/claude-agent-sdk'))
  const extension = isWin ? '.exe' : ''
  const nativePackages = isLinux
    ? [
        `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`,
        `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`
      ]
    : [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`]

  for (const packageName of nativePackages) {
    try {
      return toAsarUnpackedPath(sdkRequire.resolve(`${packageName}/claude${extension}`))
    } catch {
      // Optional native packages are platform-specific; try the next candidate.
    }
  }

  throw new Error(
    `Claude Code native binary not found for ${process.platform}-${process.arch}. Reinstall @anthropic-ai/claude-agent-sdk with optional dependencies.`
  )
}

export class ClaudeCodeBinaryService {
  private inFlight: Promise<string> | null = null
  private readyPath: string | null = null

  async ensureExecutable(): Promise<string> {
    if (!app.isPackaged) return resolveInstalledClaudeExecutablePath()
    if (this.readyPath && fs.existsSync(this.readyPath)) return this.readyPath
    if (this.inFlight) return this.inFlight
    this.inFlight = this.materializeExecutable().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async materializeExecutable(): Promise<string> {
    const manifest = readBundledArtifactManifest()
    const artifact = manifest.artifacts.claude
    const expectedOutput = isWin ? 'claude.exe' : 'claude'
    if (!artifact || artifact.kind !== 'files' || artifact.files.length !== 1) {
      throw new Error(`Bundled Claude Code payload missing for ${bundledArtifactPlatformKey()}`)
    }
    const file = artifact.files[0]
    if (file.output !== expectedOutput) {
      throw new Error(`Bundled Claude Code payload has unexpected output: ${file.output}`)
    }

    const root = application.getPath('feature.agents.claude.binary')
    const platformKey = bundledArtifactPlatformKey(manifest.platform, manifest.arch)
    const destinationDirectory = path.join(root, artifact.version, platformKey)
    const result = await ensureBundledFiles(manifest, artifact, destinationDirectory)
    const destination = result.paths.get(file.output)
    if (!destination) throw new Error(`Bundled Claude Code payload did not install ${file.output}`)
    if (result.status === 'installed') {
      logger.info('Extracted bundled Claude Code binary', { destination, version: artifact.version })
    }
    await cleanupOtherArtifactVersions(root, artifact.version)
    this.readyPath = destination
    return destination
  }
}

export const claudeCodeBinaryService = new ClaudeCodeBinaryService()
