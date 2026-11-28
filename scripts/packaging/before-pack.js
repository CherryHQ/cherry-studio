const { Arch } = require('electron-builder')
const { rebuild } = require('@electron/rebuild')
const { execFileSync, execSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parse } = require('yaml')

const { ensureLinuxNativeArtifact } = require('../linux-native/download')
const { buildSelectionPanel } = require('../../native/selection-panel/build')
const { buildExternalApp } = require('../../native/external-app/build.cjs')

// if you want to add new prebuild binaries packages with different architectures, you can add them here
// please add to allX64 and allArm64 from pnpm-lock.yaml
const packages = [
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

function isWin7Packaging(context) {
  if (process.env.CHERRY_WIN7_PACKAGING === 'true') return true
  const platform = platformToArch[context?.packager?.platform?.name]
  const electronDownload = context?.packager?.config?.electronDownload
  const mirror = electronDownload?.mirror ?? electronDownload?.mirrorOptions?.mirror
  return platform === 'win32' && typeof mirror === 'string' && mirror.includes('electron-legacy')
}
exports.isWin7Packaging = isWin7Packaging

function resolveElectronHeaderUrl(context) {
  const override = process.env.CHERRY_ELECTRON_HEADER_URL?.trim()
  if (override) return override
  if (isWin7Packaging(context)) {
    return 'https://thorium.rocks/electron-legacy/headers'
  }
  return undefined
}
exports.resolveElectronHeaderUrl = resolveElectronHeaderUrl

/**
 * Pre-Rust-1.78 Windows x64 prebuilt `.node` binaries that do not import Win8+
 * `api-ms-win-core-synch-l1-2-0.dll!WaitOnAddress` or `bcryptprimitives.dll!ProcessPrng`.
 */
const WIN7_PREBUILT_ADDONS = [
  {
    packageName: '@node-rs/xxhash-win32-x64-msvc',
    version: '1.7.0',
    tarballUrl: 'https://registry.npmjs.org/@node-rs/xxhash-win32-x64-msvc/-/xxhash-win32-x64-msvc-1.7.0.tgz',
    sha256: 'bb5717d829acc7fa5e4613b682687ddf6df082ddcd4c4291fba0f03391d4e773',
    binaryFile: 'xxhash.win32-x64-msvc.node'
  },
  {
    packageName: 'node-screenshots-win32-x64-msvc',
    version: '0.2.0',
    tarballUrl:
      'https://registry.npmjs.org/node-screenshots-win32-x64-msvc/-/node-screenshots-win32-x64-msvc-0.2.0.tgz',
    sha256: '66897ec18ae540307405f144bc482289bbecb8bec94611f671461d3630e84164',
    binaryFile: 'node-screenshots.win32-x64-msvc.node'
  },
  {
    packageName: '@napi-rs/canvas-win32-x64-msvc',
    version: '0.1.52',
    tarballUrl: 'https://registry.npmjs.org/@napi-rs/canvas-win32-x64-msvc/-/canvas-win32-x64-msvc-0.1.52.tgz',
    sha256: '1b7b8f099ced2887c640edf00d16cbf2e3d9928c7336741ceda71e066ad744dc',
    binaryFile: 'skia.win32-x64-msvc.node'
  }
]
exports.WIN7_PREBUILT_ADDONS = WIN7_PREBUILT_ADDONS

async function defaultInstallWin7Addon(addon, projectRoot) {
  const pkgJsonPath = require.resolve(`${addon.packageName}/package.json`, { paths: [projectRoot] })
  const moduleDir = path.dirname(pkgJsonPath)
  const targetBinary = path.join(moduleDir, addon.binaryFile)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-win7-addon-'))
  const tarballPath = path.join(tmpDir, 'addon.tgz')
  try {
    execFileSync('curl', ['-fSL', '--retry', '3', '--retry-all-errors', '-o', tarballPath, addon.tarballUrl], {
      stdio: 'inherit'
    })
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(tarballPath)).digest('hex')
    if (actualSha !== addon.sha256) {
      throw new Error(
        `SHA256 mismatch for ${addon.packageName}@${addon.version}: expected ${addon.sha256}, got ${actualSha}`
      )
    }
    const { extract } = await import('tar')
    await extract({
      file: tarballPath,
      cwd: tmpDir,
      strip: 1,
      filter: (entryPath) => entryPath === `package/${addon.binaryFile}`
    })
    const extracted = path.join(tmpDir, addon.binaryFile)
    if (!fs.existsSync(extracted)) {
      throw new Error(`Tarball ${addon.packageName}@${addon.version} did not contain package/${addon.binaryFile}`)
    }
    fs.copyFileSync(extracted, targetBinary)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function prepareWin7NativeAddons(context, installAddonFn = defaultInstallWin7Addon) {
  if (!isWin7Packaging(context) || context.arch !== Arch.x64) return
  const projectRoot = context.packager.projectDir
  for (const addon of WIN7_PREBUILT_ADDONS) {
    await installAddonFn(addon, projectRoot)
  }
}
exports.prepareWin7NativeAddons = prepareWin7NativeAddons

async function prepareNativeModulesForElectron(
  context,
  rebuildFn = rebuild,
  ensureLinuxArtifact = ensureLinuxNativeArtifact
) {
  const arch = context.arch === Arch.arm64 ? 'arm64' : 'x64'
  const platformName = context.packager.platform.name
  const platform = platformToArch[platformName]
  const electronVersion = context.packager.config.electronVersion
  const projectRoot = context.packager.projectDir

  if (!platform || !electronVersion) {
    throw new Error(`Cannot resolve Electron rebuild target for ${platformName}-${arch}`)
  }

  if (platform === 'linux') {
    if (context.arch !== Arch.arm64 && context.arch !== Arch.x64) {
      throw new Error(`Unsupported Linux packaging architecture: ${context.arch}`)
    }
    const artifact = ensureLinuxArtifact({ projectRoot, arch })
    process.stdout.write(
      `${artifact.cached ? 'Verified cached' : 'Downloaded'} GLIBC-compatible better-sqlite3 for ` +
        `linux-${arch} (${artifact.inspection.sha256})\n`
    )
    return
  }

  const moduleRoot = path.dirname(require.resolve('better-sqlite3/package.json', { paths: [projectRoot] }))
  const sourceBinding = path.join(moduleRoot, 'build/Release/better_sqlite3.node')
  fs.rmSync(sourceBinding, { force: true })
  const forceBuild = process.env.npm_package_config_node_gyp_force_build
  // better-sqlite3's binding.gyp skips compilation when a bundled N-API prebuild exists.
  process.env.npm_package_config_node_gyp_force_build = '1'
  const headerURL = resolveElectronHeaderUrl(context)
  try {
    await rebuildFn({
      buildPath: projectRoot,
      electronVersion,
      platform,
      arch,
      onlyModules: ['better-sqlite3'],
      force: true,
      buildFromSource: true,
      ...(headerURL ? { headerURL } : {})
    })
    // The v13 loader prefers this file over build/Release, even after a source rebuild.
    fs.copyFileSync(sourceBinding, path.join(moduleRoot, `prebuilds/${platform}-${arch}.node`))
  } finally {
    if (forceBuild === undefined) delete process.env.npm_package_config_node_gyp_force_build
    else process.env.npm_package_config_node_gyp_force_build = forceBuild
  }
}
exports.prepareNativeModulesForElectron = prepareNativeModulesForElectron

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
    .filter((p) => !fs.existsSync(path.join(__dirname, '../..', 'node_modules', p)))
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

function prepareSystemSpeechHelper(
  context,
  buildNativeHelper = require('../../native/system-speech/scripts/build-native.cjs').buildNativeHelper
) {
  const platform = platformToArch[context.packager.platform.name]
  const arch = Arch[context.arch]
  if (platform === 'darwin') {
    buildNativeHelper(arch, platform)
  } else if (platform === 'win32') {
    const config = context.packager.config.win
    const destination = 'system-speech/cherry-system-speech.exe'
    const resources = (config.extraResources ?? []).filter((resource) => resource.to !== destination)
    if (arch === 'x64') {
      buildNativeHelper(arch, platform)
      resources.push({
        from: 'native/system-speech/dist/native/win32-x64/cherry-system-speech.exe',
        to: destination
      })
    }
    config.extraResources = resources
  }
}
exports.prepareSystemSpeechHelper = prepareSystemSpeechHelper

const getNativeModuleFilters = (platform, arch) => {
  const keptPackages = keepPackages(platform, arch)
  return [
    ...packages.filter((name) => !keptPackages.includes(name)).map((name) => `!**/node_modules/${name}/**`),
    `!**/node_modules/better-sqlite3/prebuilds/!(${platform}-${arch}.node)`,
    `!**/node_modules/selection-hook/prebuilds/!(${platform}-${arch})/**`
  ]
}
exports.getNativeModuleFilters = getNativeModuleFilters

exports.default = async function (context) {
  const arch = context.arch === Arch.arm64 ? 'arm64' : 'x64'
  const platformName = context.packager.platform.name
  const platform = platformToArch[platformName]

  prepareSystemSpeechHelper(context)

  await prepareNativeModulesForElectron(context)
  await prepareWin7NativeAddons(context)
  buildSelectionPanel({ platform, arch })
  buildExternalApp({ platform, arch, packaging: true })
  assertPrebuiltPackages(platform, arch)

  const win7 = isWin7Packaging(context)
  console.log(`Downloading bundled binaries for ${platform}-${arch}${win7 ? ' (win7 compatible)' : ''}...`)
  execSync(
    `node "${path.join(__dirname, '../download-binaries.js')}" ${platform} ${arch} --packaging${win7 ? ' --win7' : ''}`,
    {
      stdio: 'inherit'
    }
  )
  // Fail the build rather than ship a half-empty resources/binaries/<platform>.
  const downloadBinaries = require('../download-binaries')
  downloadBinaries.verifyBundledBinaries(platform, arch, {
    tools: downloadBinaries.resolveToolsForTarget({ win7 })
  })

  const excludePackages = async (packagesToExclude) => {
    // 从项目根目录的 electron-builder.yml 读取 files 配置，避免多次覆盖配置导致出错
    const electronBuilderConfigPath = path.join(__dirname, '../..', 'electron-builder.yml')
    const electronBuilderConfig = parse(fs.readFileSync(electronBuilderConfigPath, 'utf-8'))
    let filters = electronBuilderConfig.files

    // add filters for other architectures (exclude them)
    filters.push(...packagesToExclude)

    context.packager.config.files[0].filter = filters
  }

  const currentPlatformKey = `${platform}-${arch}`
  // win32-arm64 is in this list so `build:win` (--x64 --arm64) can package it. The
  // @aiany/sqlite-vec fork provides a windows-arm64 vec0.dll, so knowledge-base vector
  // search works on that target too.
  const allBinaryPlatforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']
  const excludeBundledBinaryFilters = allBinaryPlatforms
    .filter((p) => p !== currentPlatformKey)
    .map((p) => '!resources/binaries/' + p + '/**')

  await excludePackages([...getNativeModuleFilters(platform, arch), ...excludeBundledBinaryFilters])
}
