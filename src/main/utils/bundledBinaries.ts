import { createRequire } from 'node:module'
import path from 'node:path'

import { toAsarUnpackedPath } from '.'

const require_ = createRequire(import.meta.url)

type LinuxLibc = 'glibc' | 'musl'
type BundledBinaryPlatform = 'darwin' | 'linux' | 'win32'

function assertSupportedTarget(
  binaryName: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): asserts platform is BundledBinaryPlatform {
  const supportedPlatform = platform === 'darwin' || platform === 'linux' || platform === 'win32'
  const supportedArchitecture = arch === 'arm64' || arch === 'x64'

  if (!supportedPlatform || !supportedArchitecture) {
    throw new Error(`Bundled ${binaryName} is not available for ${platform}-${arch}`)
  }
}

function detectLinuxLibc(): LinuxLibc {
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    return report?.header?.glibcVersionRuntime ? 'glibc' : 'musl'
  } catch {
    return 'musl'
  }
}

export function getClaudeNativePackageCandidates(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  linuxLibc?: LinuxLibc
): string[] {
  assertSupportedTarget('Claude Code native binary', platform, arch)

  if (platform === 'linux') {
    const resolvedLinuxLibc = linuxLibc ?? detectLinuxLibc()
    const glibcPackage = `@anthropic-ai/claude-agent-sdk-linux-${arch}`
    const muslPackage = `${glibcPackage}-musl`
    return resolvedLinuxLibc === 'glibc' ? [glibcPackage, muslPackage] : [muslPackage, glibcPackage]
  }

  return [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`]
}

export function resolveClaudeExecutablePath(): string {
  const sdkRequire = createRequire(require_.resolve('@anthropic-ai/claude-agent-sdk'))
  const extension = process.platform === 'win32' ? '.exe' : ''

  for (const packageName of getClaudeNativePackageCandidates()) {
    try {
      return toAsarUnpackedPath(sdkRequire.resolve(`${packageName}/claude${extension}`))
    } catch {
      // Optional native packages are platform-specific; try the next candidate.
    }
  }

  throw new Error(
    `Claude Code native binary not found for ${process.platform}-${process.arch}. ` +
      'Reinstall @anthropic-ai/claude-agent-sdk with optional dependencies.'
  )
}

export function getRipgrepPlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string {
  assertSupportedTarget('ripgrep', platform, arch)
  return `${arch}-${platform}`
}

export function resolveBundledRipgrepPath(): string {
  const packageRoot = path.dirname(require_.resolve('@cherrystudio/ripgrep/package.json'))
  const executable = process.platform === 'win32' ? 'rg.exe' : 'rg'

  return toAsarUnpackedPath(path.join(packageRoot, 'vendor', 'ripgrep', getRipgrepPlatformKey(), executable))
}
