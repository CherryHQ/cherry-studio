const { Arch } = require('electron-builder')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { parse } = require('yaml')

const { ensureLinuxNativeArtifact } = require('./linux-native/download')
const { bundleFilesArtifact, readManifest, verifyBundledArtifacts, writeManifest } = require('./download-binaries')

// if you want to add new prebuild binaries packages with different architectures, you can add them here
// please add to allX64 and allArm64 from pnpm-lock.yaml
const packages = [
  '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  '@anthropic-ai/claude-agent-sdk-darwin-x64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
  '@anthropic-ai/claude-agent-sdk-linux-x64',
  '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
  '@anthropic-ai/claude-agent-sdk-win32-arm64',
  '@anthropic-ai/claude-agent-sdk-win32-x64',
  // anydoc converts binary office documents to markdown for the knowledge base.
  // It ships no win32-arm64 build and no wasm fallback, so existing formats use
  // their legacy readers there while newly supported .ppt fails visibly.
  '@firecrawl/anydoc-darwin-arm64',
  '@firecrawl/anydoc-darwin-x64',
  '@firecrawl/anydoc-linux-arm64-gnu',
  '@firecrawl/anydoc-linux-arm64-musl',
  '@firecrawl/anydoc-linux-x64-gnu',
  '@firecrawl/anydoc-linux-x64-musl',
  '@firecrawl/anydoc-win32-x64-msvc',
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-libvips-darwin-arm64',
  '@img/sharp-libvips-darwin-x64',
  '@img/sharp-libvips-linux-arm64',
  '@img/sharp-libvips-linuxmusl-arm64',
  '@img/sharp-libvips-linux-x64',
  '@img/sharp-libvips-linuxmusl-x64',
  '@img/sharp-linux-arm64',
  '@img/sharp-linux-x64',
  '@img/sharp-linuxmusl-arm64',
  '@img/sharp-linuxmusl-x64',
  '@img/sharp-win32-arm64',
  '@img/sharp-win32-x64',
  '@napi-rs/system-ocr-darwin-arm64',
  '@napi-rs/system-ocr-darwin-x64',
  '@napi-rs/system-ocr-win32-arm64-msvc',
  '@napi-rs/system-ocr-win32-x64-msvc',
  '@napi-rs/canvas-linux-x64-gnu',
  '@napi-rs/canvas-linux-x64-musl',
  '@napi-rs/canvas-linux-arm64-gnu',
  '@napi-rs/canvas-linux-arm64-musl',
  '@napi-rs/canvas-darwin-x64',
  '@napi-rs/canvas-darwin-arm64',
  '@napi-rs/canvas-win32-x64-msvc',
  '@napi-rs/canvas-win32-arm64-msvc',
  '@node-rs/xxhash-darwin-arm64',
  '@node-rs/xxhash-darwin-x64',
  '@node-rs/xxhash-linux-arm64-gnu',
  '@node-rs/xxhash-linux-arm64-musl',
  '@node-rs/xxhash-linux-x64-gnu',
  '@node-rs/xxhash-linux-x64-musl',
  '@node-rs/xxhash-win32-arm64-msvc',
  '@node-rs/xxhash-win32-x64-msvc',
  // sqlite-vec prebuilt extensions (vec0.dylib/.so/.dll), from the @aiany/sqlite-vec fork
  // which adds a windows-arm64 build (upstream ships none). Note the package names use
  // `windows`, not `win32` — see platformTokens below for why the keep-filter must match both.
  '@aiany/sqlite-vec-darwin-arm64',
  '@aiany/sqlite-vec-darwin-x64',
  '@aiany/sqlite-vec-linux-arm64',
  '@aiany/sqlite-vec-linux-x64',
  '@aiany/sqlite-vec-windows-arm64',
  '@aiany/sqlite-vec-windows-x64'
]

const platformToArch = {
  mac: 'darwin',
  windows: 'win32',
  linux: 'linux',
  linuxmusl: 'linuxmusl'
}

// Most native packages encode Electron's platform key (win32) in their name, but some
// (e.g. sqlite-vec) use the npm `windows` convention. Match either so a win32 build keeps
// sqlite-vec-windows-x64 instead of wrongly excluding it.
const keepPackages = (platform, arch) => {
  const platformTokens = platform === 'win32' ? ['win32', 'windows'] : [platform]
  return packages.filter((p) => p.includes(arch) && platformTokens.some((t) => p.includes(t)))
}

const nativePackageExcludeFilters = (platform, arch) => {
  const currentKeepPackages = new Set(keepPackages(platform, arch))
  return packages
    .filter((packageName) => !currentKeepPackages.has(packageName))
    .map((packageName) => `!node_modules/${packageName}/**`)
}
exports.nativePackageExcludeFilters = nativePackageExcludeFilters

// Cross-arch prebuilt packages come from supportedArchitectures in pnpm-workspace.yaml —
// pnpm ignores that setting once node_modules exists, so it can't be flipped per pack pass.
// Anything kept for this arch but never installed is a native module the app would fail to
// load at runtime, so stop here instead of shipping it. musl builds are excluded: pnpm
// installs them only on a musl host, and releases are built on glibc.
const assertPrebuiltPackages = (platform, arch) => {
  const missingPackages = keepPackages(platform, arch)
    .filter((p) => !p.includes('musl'))
    .filter((p) => !fs.existsSync(path.join(__dirname, '..', 'node_modules', p)))
  if (missingPackages.length > 0) {
    throw new Error(
      `Missing prebuilt packages for ${platform}-${arch}: ${missingPackages.join(', ')}\n` +
        `Run \`rm -rf node_modules && pnpm install\` — pnpm only reads supportedArchitectures ` +
        `on a fresh install, so plain \`pnpm install\` (even --force) will not fix it.`
    )
  }
}
exports.assertPrebuiltPackages = assertPrebuiltPackages

const claudeNativePackageName = (platform, arch) => `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
exports.claudeNativePackageName = claudeNativePackageName

const readPackageVersion = (projectRoot, packageName) => {
  const manifestPath = path.join(projectRoot, 'node_modules', packageName, 'package.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing package manifest: ${manifestPath}`)
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version
}

const assertClaudeAgentSdkNativeVersion = (platform, arch, options = {}) => {
  const projectRoot = options.projectRoot ?? path.join(__dirname, '..')
  const sdkPackage = '@anthropic-ai/claude-agent-sdk'
  const nativePackage = claudeNativePackageName(platform, arch)
  const sdkVersion = readPackageVersion(projectRoot, sdkPackage)
  const nativeVersion = readPackageVersion(projectRoot, nativePackage)
  if (sdkVersion !== nativeVersion) {
    throw new Error(
      `Claude Agent SDK native package version mismatch for ${platform}-${arch}: ` +
        `${sdkPackage}@${sdkVersion} != ${nativePackage}@${nativeVersion}`
    )
  }

  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude'
  const binaryPath = path.join(projectRoot, 'node_modules', nativePackage, binaryName)
  if (!fs.existsSync(binaryPath)) throw new Error(`Claude Code native binary missing: ${binaryPath}`)
  return { binaryName, binaryPath, nativePackage, version: sdkVersion }
}
exports.assertClaudeAgentSdkNativeVersion = assertClaudeAgentSdkNativeVersion

const bundleClaudeAgentSdk = async (platform, arch, options = {}) => {
  const projectRoot = options.projectRoot ?? path.join(__dirname, '..')
  const resourcesDir = options.resourcesDir ?? path.join(projectRoot, 'resources', 'binaries')
  const platformKey = `${platform}-${arch}`
  const outputDir = path.join(resourcesDir, platformKey)
  const claude = assertClaudeAgentSdkNativeVersion(platform, arch, { projectRoot })
  fs.mkdirSync(outputDir, { recursive: true })

  const artifact = await bundleFilesArtifact({
    version: claude.version,
    files: [
      {
        source: claude.binaryPath,
        output: claude.binaryName,
        archive: 'claude.zst',
        mode: 0o755
      }
    ],
    outputDir
  })
  const manifest = readManifest(outputDir, platform, arch)
  manifest.artifacts.claude = artifact
  writeManifest(outputDir, manifest)
  return artifact
}
exports.bundleClaudeAgentSdk = bundleClaudeAgentSdk

exports.default = async function (context) {
  const arch = context.arch === Arch.arm64 ? 'arm64' : 'x64'
  const platformName = context.packager.platform.name
  const platform = platformToArch[platformName]

  assertPrebuiltPackages(platform, arch)

  if (platform === 'linux') {
    const linuxArch = context.arch === Arch.arm64 ? 'arm64' : context.arch === Arch.x64 ? 'x64' : null
    if (!linuxArch) throw new Error(`Unsupported Linux packaging architecture: ${context.arch}`)

    const projectRoot = path.join(__dirname, '..')
    const artifact = ensureLinuxNativeArtifact({ projectRoot, arch: linuxArch })
    process.stdout.write(
      `${artifact.cached ? 'Verified cached' : 'Downloaded'} GLIBC-compatible better-sqlite3 for ` +
        `linux-${linuxArch} (${artifact.inspection.sha256})\n`
    )
  }

  console.log(`Downloading bundled binaries for ${platform}-${arch}...`)
  execSync(`node "${path.join(__dirname, 'download-binaries.js')}" ${platform} ${arch}`, { stdio: 'inherit' })
  await bundleClaudeAgentSdk(platform, arch)
  // Fail the build rather than ship a half-empty or corrupt payload set.
  await verifyBundledArtifacts(platform, arch, { requiredArtifactNames: ['claude'] })

  const excludePackages = async (packagesToExclude) => {
    // 从项目根目录的 electron-builder.yml 读取 files 配置，避免多次覆盖配置导致出错
    const electronBuilderConfigPath = path.join(__dirname, '..', 'electron-builder.yml')
    const electronBuilderConfig = parse(fs.readFileSync(electronBuilderConfigPath, 'utf-8'))
    let filters = electronBuilderConfig.files

    // add filters for other architectures (exclude them)
    filters.push(...packagesToExclude)

    context.packager.config.files[0].filter = filters
  }

  const nativeExcludePackages = nativePackageExcludeFilters(platform, arch)

  const currentPlatformKey = `${platform}-${arch}`
  // win32-arm64 is in this list so `build:win` (--x64 --arm64) can package it. The
  // @aiany/sqlite-vec fork provides a windows-arm64 vec0.dll, so knowledge-base vector
  // search works on that target too.
  const allBinaryPlatforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']
  const excludeBundledBinaryFilters = allBinaryPlatforms
    .filter((p) => p !== currentPlatformKey)
    .map((p) => '!resources/binaries/' + p + '/**')

  await excludePackages([...nativeExcludePackages, ...excludeBundledBinaryFilters])
}
