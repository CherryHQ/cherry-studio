const { Arch } = require('electron-builder')
const { execSync } = require('child_process')
const fs = require('fs')
const { createRequire } = require('module')
const path = require('path')
const { parse } = require('yaml')

const { ensureLinuxNativeArtifact } = require('./linux-native/download')

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
  '@aiany/sqlite-vec-windows-x64',
  // Screen capture backend. Its platform binaries are npm sibling packages, not nested
  // under the main package, so they are declared in optionalDependencies like every other
  // family here — that is what puts them at top-level node_modules where the keep/exclude
  // filters and the asarUnpack glob can see them. loong64 is omitted: not a target arch.
  'node-screenshots-darwin-arm64',
  'node-screenshots-darwin-x64',
  'node-screenshots-linux-arm64-gnu',
  'node-screenshots-linux-x64-gnu',
  'node-screenshots-linux-x64-musl',
  'node-screenshots-win32-arm64-msvc',
  'node-screenshots-win32-ia32-msvc',
  'node-screenshots-win32-x64-msvc',
  // macOS permission prompts. Unlike everything above, one package covers both arches.
  'node-mac-permissions'
]

/**
 * Platform-gated packages whose names carry no arch token, so the name matcher in
 * {@link keepPackages} cannot classify them. Kept for every arch of their own platform and
 * excluded everywhere else — otherwise a Windows or Linux package cross-built on a Mac
 * would ship a darwin-only `.node`.
 */
const platformOnlyPackages = {
  darwin: ['node-mac-permissions']
}

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
  return [
    ...packages.filter((p) => p.includes(arch) && platformTokens.some((t) => p.includes(t))),
    ...(platformOnlyPackages[platform] ?? [])
  ]
}

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
exports.keepPackages = keepPackages

const resolvePackageManifest = (packageName, require_) => {
  for (const searchPath of require_.resolve.paths(packageName) ?? []) {
    const candidate = path.join(searchPath, ...packageName.split('/'), 'package.json')
    if (!fs.existsSync(candidate)) continue

    const manifestPath = fs.realpathSync(candidate)
    return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath }
  }
}

const collectDshRuntimePackageNames = (projectRoot) => {
  const rootManifestPath = path.join(projectRoot, 'package.json')
  const rootRequire = createRequire(rootManifestPath)
  const packageNames = new Set()
  const requiredPeers = new Set()
  const visitedManifests = new Set()

  const visit = (packageName, require_, optional = false) => {
    const resolved = resolvePackageManifest(packageName, require_)
    if (!resolved) {
      if (optional) return
      throw new Error(`Missing DSH runtime package ${packageName}`)
    }

    packageNames.add(packageName)
    if (visitedManifests.has(resolved.manifestPath)) return
    visitedManifests.add(resolved.manifestPath)

    const packageRequire = createRequire(resolved.manifestPath)
    for (const dependency of Object.keys(resolved.manifest.dependencies ?? {})) {
      visit(dependency, packageRequire)
    }
    for (const dependency of Object.keys(resolved.manifest.optionalDependencies ?? {})) {
      visit(dependency, packageRequire, true)
    }
    for (const peer of Object.keys(resolved.manifest.peerDependencies ?? {})) {
      if (!resolved.manifest.peerDependenciesMeta?.[peer]?.optional) requiredPeers.add(peer)
    }
  }

  visit('@cherrystudio/dsh-bridge', rootRequire)

  const missingPeers = [...requiredPeers].filter((peer) => !packageNames.has(peer)).sort()
  if (missingPeers.length) throw new Error(`Missing production DSH peer dependencies: ${missingPeers.join(', ')}`)

  return [...packageNames].sort()
}
exports.collectDshRuntimePackageNames = collectDshRuntimePackageNames

const buildDshAsarUnpackPatterns = (projectRoot) =>
  collectDshRuntimePackageNames(projectRoot).flatMap((packageName) => [
    `node_modules/${packageName}/**`,
    `node_modules/**/node_modules/${packageName}/**`
  ])
exports.buildDshAsarUnpackPatterns = buildDshAsarUnpackPatterns

exports.default = async function (context) {
  const arch = context.arch === Arch.arm64 ? 'arm64' : 'x64'
  const platformName = context.packager.platform.name
  const platform = platformToArch[platformName]
  const projectRoot = path.join(__dirname, '..')

  assertPrebuiltPackages(platform, arch)

  const configuredAsarUnpack = context.packager.config.asarUnpack
  const dshAsarUnpack = buildDshAsarUnpackPatterns(projectRoot)
  context.packager.config.asarUnpack = [
    ...(Array.isArray(configuredAsarUnpack)
      ? configuredAsarUnpack
      : configuredAsarUnpack
        ? [configuredAsarUnpack]
        : []),
    ...dshAsarUnpack
  ]
  process.stdout.write(`Unpacking ${dshAsarUnpack.length / 2} DSH runtime dependency packages\n`)

  if (platform === 'linux') {
    const linuxArch = context.arch === Arch.arm64 ? 'arm64' : context.arch === Arch.x64 ? 'x64' : null
    if (!linuxArch) throw new Error(`Unsupported Linux packaging architecture: ${context.arch}`)

    const artifact = ensureLinuxNativeArtifact({ projectRoot, arch: linuxArch })
    process.stdout.write(
      `${artifact.cached ? 'Verified cached' : 'Downloaded'} GLIBC-compatible better-sqlite3 for ` +
        `linux-${linuxArch} (${artifact.inspection.sha256})\n`
    )
  }

  console.log(`Downloading bundled binaries for ${platform}-${arch}...`)
  execSync(`node "${path.join(__dirname, 'download-binaries.js')}" ${platform} ${arch}`, { stdio: 'inherit' })
  // Fail the build rather than ship a half-empty resources/binaries/<platform>.
  require('./download-binaries').verifyBundledBinaries(platform, arch)

  const excludePackages = async (packagesToExclude) => {
    // 从项目根目录的 electron-builder.yml 读取 files 配置，避免多次覆盖配置导致出错
    const electronBuilderConfigPath = path.join(__dirname, '..', 'electron-builder.yml')
    const electronBuilderConfig = parse(fs.readFileSync(electronBuilderConfigPath, 'utf-8'))
    let filters = electronBuilderConfig.files

    // add filters for other architectures (exclude them)
    filters.push(...packagesToExclude)

    context.packager.config.files[0].filter = filters
  }

  const arm64KeepPackages = keepPackages(platform, 'arm64')
  const arm64ExcludePackages = packages
    .filter((p) => !arm64KeepPackages.includes(p))
    .map((p) => '!node_modules/' + p + '/**')

  const x64KeepPackages = keepPackages(platform, 'x64')
  const x64ExcludePackages = packages
    .filter((p) => !x64KeepPackages.includes(p))
    .map((p) => '!node_modules/' + p + '/**')

  const currentPlatformKey = `${platform}-${arch}`
  // win32-arm64 is in this list so `build:win` (--x64 --arm64) can package it. The
  // @aiany/sqlite-vec fork provides a windows-arm64 vec0.dll, so knowledge-base vector
  // search works on that target too.
  const allBinaryPlatforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']
  const excludeBundledBinaryFilters = allBinaryPlatforms
    .filter((p) => p !== currentPlatformKey)
    .map((p) => '!resources/binaries/' + p + '/**')

  if (context.arch === Arch.arm64) {
    await excludePackages([...arm64ExcludePackages, ...excludeBundledBinaryFilters])
  } else {
    await excludePackages([...x64ExcludePackages, ...excludeBundledBinaryFilters])
  }
}
