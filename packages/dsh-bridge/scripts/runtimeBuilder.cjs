const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const { builtinModules, createRequire } = require('module')
const path = require('path')

const { bundleTreeArtifact, writeManifest } = require('../../../scripts/download-binaries')

const DSH_RUNTIME_PACKAGE = '@cherrystudio/dsh-bridge'
const DSH_RUNTIME_FILTER_VERSION = 6
const DSH_RUNTIME_ARCHIVE = 'dsh-runtime.tar.zst'
const DSH_RUNTIME_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64'
])
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.github',
  '__tests__',
  'benchmarks',
  'coverage',
  'doc',
  'docs',
  'examples',
  'fixtures',
  'test',
  'tests'
])
const DSH_RUNTIME_NATIVE_EXTENSIONS = new Set(['.dll', '.dylib', '.exe', '.node', '.so', '.wasm'])
const DSH_RUNTIME_SOURCE_EXTENSIONS = new Set([
  '.asm',
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.def',
  '.gyp',
  '.gypi',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
  '.inc',
  '.m',
  '.mm',
  '.s'
])
const DSH_RUNTIME_BUILD_ARTIFACT_EXTENSIONS = new Set(['.a', '.ilk', '.o', '.obj', '.pdb'])
const DSH_RUNTIME_BUILD_FILE_NAMES = new Set(['binding.gyp', 'cmakelists.txt', 'configure', 'configure.ac', 'makefile'])
const DSH_RUNTIME_TEST_FILE = /(?:^|[._-])(test|spec)(?:[._-]|$)/i
const DSH_RUNTIME_BUILD_METADATA =
  /(?:^|[/\\])(?:babel|biome|esbuild|jest|jsconfig|rollup|rspack|swc|tsconfig|tsup|turbo|vite|vitest|webpack)(?:[.-][^/\\]+)*\.(?:c?js|json|mjs|ts)$/i
const NODE_BUILTIN_MODULES = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

function normalizeRelativePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function packageNameAt(relativePath) {
  const segments = normalizeRelativePath(relativePath).split('/')
  let packageName
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== 'node_modules' || !segments[index + 1]) continue
    if (segments[index + 1].startsWith('@')) {
      if (!segments[index + 2]) continue
      packageName = `${segments[index + 1]}/${segments[index + 2]}`
      index += 1
    } else {
      packageName = segments[index + 1]
    }
  }
  return packageName
}

function isForeignNativePath(relativePath, platform, arch) {
  const normalized = normalizeRelativePath(relativePath)
  const nativeTarget = normalized.match(
    /(?:^|[/_-])(aix|android|darwin|freebsd|linux|openbsd|sunos|win10|win32|windows)[-_](arm64|arm|ia32|loong64|ppc64le|riscv64|s390x|x64|x86)(?:[/_-]|$)/i
  )
  if (!nativeTarget) return false
  const targetPlatform = nativeTarget[1].toLowerCase()
  const targetArch = nativeTarget[2].toLowerCase()
  const platformMatches =
    platform === 'win32' ? ['win32', 'windows', 'win10'].includes(targetPlatform) : targetPlatform === platform
  return !platformMatches || targetArch !== arch
}

function shouldKeepRuntimePath(relativePath, platform, arch) {
  const normalized = normalizeRelativePath(relativePath)
  const segments = normalized.split('/')
  const basename = segments.at(-1) ?? ''

  if (segments.includes('.pnpm') || segments.includes('.bin')) return false
  if (normalized.startsWith('node_modules/@cherrystudio/dsh-bridge/dist/runtime/')) return false
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false
  if (DSH_RUNTIME_BUILD_METADATA.test(normalized)) return false
  if (DSH_RUNTIME_BUILD_FILE_NAMES.has(basename.toLowerCase())) return false
  if (/^(?:npm-shrinkwrap\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(basename)) {
    return false
  }
  if (/^(?:README|LICENSE|CHANGELOG)(?:[._-]|$)/i.test(basename)) return false
  if (/\.(?:map|d\.[cm]?ts|[cm]?ts|tsx)$/i.test(basename)) return false

  const extension = path.extname(basename).toLowerCase()
  if (DSH_RUNTIME_SOURCE_EXTENSIONS.has(extension)) return false
  if (DSH_RUNTIME_BUILD_ARTIFACT_EXTENSIONS.has(extension)) return false
  if (DSH_RUNTIME_TEST_FILE.test(path.parse(basename).name)) return false
  if (DSH_RUNTIME_NATIVE_EXTENSIONS.has(extension) && isForeignNativePath(normalized, platform, arch)) return false
  return true
}

function copyRuntimeEntry(sourcePath, destinationPath, relativePath, options, activeRealPaths = new Set()) {
  const packageName = packageNameAt(relativePath)
  if (packageName && options.packageNames && !options.packageNames.has(packageName)) return
  if (relativePath && isForeignNativePath(relativePath, options.platform, options.arch)) return
  if (relativePath.split('/').includes('.pnpm') || relativePath.split('/').includes('.bin')) return
  const stat = fs.lstatSync(sourcePath)
  if (stat.isSymbolicLink()) {
    const realPath = fs.realpathSync(sourcePath)
    if (activeRealPaths.has(realPath)) return
    const nextActive = new Set(activeRealPaths).add(realPath)
    copyRuntimeEntry(realPath, destinationPath, relativePath, options, nextActive)
    return
  }

  if (stat.isDirectory()) {
    if (!relativePath || shouldKeepRuntimePath(`${relativePath}/package.json`, options.platform, options.arch)) {
      fs.mkdirSync(destinationPath, { recursive: true })
    } else if (relativePath.split('/').some((segment) => EXCLUDED_DIRECTORIES.has(segment))) {
      return
    }
    for (const entry of fs.readdirSync(sourcePath).sort()) {
      if (options.skipNestedNodeModules && entry === 'node_modules') continue
      copyRuntimeEntry(
        path.join(sourcePath, entry),
        path.join(destinationPath, entry),
        relativePath ? `${relativePath}/${entry}` : entry,
        options,
        activeRealPaths
      )
    }
    return
  }

  if (!stat.isFile() || !shouldKeepRuntimePath(relativePath, options.platform, options.arch)) return
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.copyFileSync(sourcePath, destinationPath)
  fs.chmodSync(destinationPath, stat.mode & 0o777)
}

function dependencyNamesFromManifest(manifest) {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...(Array.isArray(manifest.bundledDependencies)
      ? manifest.bundledDependencies
      : Array.isArray(manifest.bundleDependencies)
        ? manifest.bundleDependencies
        : [])
  ]
}

function copyRuntimePackageGraph(sourcePackageDir, destinationPackageDir, relativePath, options, state) {
  const realSource = fs.realpathSync(sourcePackageDir)
  if (isForeignNativePath(relativePath, options.platform, options.arch)) return
  const visitKey = `${realSource}\0${destinationPackageDir}`
  if (state.visited.has(visitKey)) return
  state.visited.add(visitKey)

  copyRuntimeEntry(realSource, destinationPackageDir, relativePath, {
    ...options,
    skipNestedNodeModules: true
  })

  const manifestPath = path.join(realSource, 'package.json')
  if (!fs.existsSync(manifestPath)) return
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const packageRequire = createRequire(manifestPath)
  for (const dependencyName of dependencyNamesFromManifest(manifest)) {
    if (dependencyName.startsWith('@types/')) continue
    const optional = Boolean(
      manifest.optionalDependencies?.[dependencyName] || manifest.peerDependenciesMeta?.[dependencyName]?.optional
    )
    const resolved = resolvePackageManifest(dependencyName, packageRequire)
    if (!resolved) {
      if (optional) continue
      throw new Error(`Missing DSH runtime package ${dependencyName} required by ${manifest.name}`)
    }

    const dependencySource = path.dirname(resolved.manifestPath)
    const rootDestination = path.join(state.runtimeRoot, 'node_modules', ...dependencyName.split('/'))
    const existing = state.rootPackages.get(dependencyName)
    let dependencyDestination = rootDestination
    if (existing) {
      if (existing.source !== fs.realpathSync(dependencySource)) {
        dependencyDestination = path.join(destinationPackageDir, 'node_modules', ...dependencyName.split('/'))
      } else {
        dependencyDestination = existing.destination
      }
    } else {
      state.rootPackages.set(dependencyName, {
        destination: rootDestination,
        source: fs.realpathSync(dependencySource)
      })
    }

    copyRuntimePackageGraph(
      dependencySource,
      dependencyDestination,
      path.relative(state.runtimeRoot, dependencyDestination).replaceAll(path.sep, '/'),
      options,
      state
    )
  }
}

function resolvePackageManifest(packageName, require_) {
  for (const searchPath of require_.resolve.paths(packageName) ?? []) {
    const candidate = path.join(searchPath, ...packageName.split('/'), 'package.json')
    if (!fs.existsSync(candidate)) continue
    const manifestPath = fs.realpathSync(candidate)
    return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath }
  }
}

function collectDependencyNames(projectRoot, roots) {
  const rootRequire = createRequire(path.join(projectRoot, 'package.json'))
  const names = new Set()
  const visitedManifests = new Set()
  const visit = (packageName, require_, optional = false) => {
    if (NODE_BUILTIN_MODULES.has(packageName) || packageName.startsWith('@types/')) return
    const resolved = resolvePackageManifest(packageName, require_)
    if (!resolved) {
      if (optional) return
      throw new Error(`Missing DSH runtime package ${packageName}`)
    }
    names.add(packageName)
    if (visitedManifests.has(resolved.manifestPath)) return
    visitedManifests.add(resolved.manifestPath)
    const packageRequire = createRequire(resolved.manifestPath)
    for (const dependency of Object.keys(resolved.manifest.dependencies ?? {})) visit(dependency, packageRequire)
    for (const dependency of Object.keys(resolved.manifest.optionalDependencies ?? {})) {
      visit(dependency, packageRequire, true)
    }
    for (const peer of Object.keys(resolved.manifest.peerDependencies ?? {})) {
      visit(peer, packageRequire, Boolean(resolved.manifest.peerDependenciesMeta?.[peer]?.optional))
    }
    const bundledDependencies = resolved.manifest.bundledDependencies ?? resolved.manifest.bundleDependencies
    for (const bundled of Array.isArray(bundledDependencies) ? bundledDependencies : []) {
      visit(bundled, packageRequire)
    }
  }
  for (const root of roots) visit(root, rootRequire)
  return [...names].sort()
}

function collectDshRuntimePackageNames(projectRoot) {
  return collectDependencyNames(projectRoot, [DSH_RUNTIME_PACKAGE])
}

function dshRuntimePackageExcludeNames(projectRoot) {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const dshNames = new Set(collectDshRuntimePackageNames(projectRoot))
  const applicationRoots = Object.keys(rootManifest.dependencies ?? {}).filter((name) => name !== DSH_RUNTIME_PACKAGE)
  const applicationNames = new Set(collectDependencyNames(projectRoot, applicationRoots))
  return [...dshNames].filter((name) => name !== DSH_RUNTIME_PACKAGE && !applicationNames.has(name)).sort()
}

function dshRuntimePackageExcludeFilters(projectRoot) {
  return dshRuntimePackageExcludeNames(projectRoot).flatMap((name) => [
    `!node_modules/${name}/**`,
    `!node_modules/**/node_modules/${name}/**`
  ])
}

function walkPackages(nodeModulesDirectory, result, platform, arch) {
  if (!fs.existsSync(nodeModulesDirectory)) return
  for (const entry of fs
    .readdirSync(nodeModulesDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === '.pnpm' || entry.name === '.bin') continue
    if (entry.name.startsWith('@')) {
      const scopeDirectory = path.join(nodeModulesDirectory, entry.name)
      for (const scoped of fs
        .readdirSync(scopeDirectory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        visitPackageDirectory(path.join(scopeDirectory, scoped.name), result, platform, arch)
      }
      continue
    }
    visitPackageDirectory(path.join(nodeModulesDirectory, entry.name), result, platform, arch)
  }
}

function visitPackageDirectory(packageDirectory, result, platform, arch) {
  const manifestPath = path.join(packageDirectory, 'package.json')
  if (!fs.existsSync(manifestPath)) return
  if (
    isForeignNativePath(path.relative(path.dirname(path.dirname(packageDirectory)), packageDirectory), platform, arch)
  )
    return
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  result.push({
    directory: packageDirectory,
    manifestPath,
    manifest,
    name: manifest.name ?? path.basename(packageDirectory)
  })
  walkPackages(path.join(packageDirectory, 'node_modules'), result, platform, arch)
}

function collectRuntimePackages(runtimeRoot, platform, arch) {
  const packages = []
  walkPackages(path.join(runtimeRoot, 'node_modules'), packages, platform, arch)
  return packages.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath))
}

function collectConcreteExportValues(value, values, conditions = []) {
  if (typeof value === 'string') {
    if (
      !value.includes('*') &&
      !conditions.some((condition) => condition === 'types' || condition === 'source' || condition.endsWith('/source'))
    ) {
      values.add(value)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConcreteExportValues(item, values, conditions)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) collectConcreteExportValues(item, values, [...conditions, key])
}

function collectExportSpecifiers(value, packageName, specifiers, subpath = '.') {
  if (typeof value === 'string' || Array.isArray(value)) {
    if (!subpath.includes('*') && (typeof value !== 'string' || !value.includes('*'))) {
      specifiers.add(subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`)
    }
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key === 'types' || key === 'source' || key.endsWith('/source') || key.startsWith('types@')) continue
    if (key.startsWith('.')) collectExportSpecifiers(item, packageName, specifiers, key)
    else collectExportSpecifiers(item, packageName, specifiers, subpath)
  }
}

function addResolvedEntrypoint(runtimeRoot, entrypoints, candidate) {
  let resolved
  try {
    resolved = fs.realpathSync(candidate)
  } catch (error) {
    throw new Error(`DSH runtime entrypoint is missing: ${candidate}`, { cause: error })
  }
  const relative = normalizeRelativePath(path.relative(fs.realpathSync(runtimeRoot), resolved))
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`DSH runtime entrypoint escaped staging root: ${candidate} -> ${resolved} (root ${runtimeRoot})`)
  }
  if (!fs.statSync(resolved).isFile()) throw new Error(`DSH runtime entrypoint is not a file: ${candidate}`)
  entrypoints.add(relative)
}

function collectRuntimeEntrypoints(runtimeRoot, platform, arch) {
  const entrypoints = new Set()
  for (const { directory, manifestPath, manifest, name } of collectRuntimePackages(runtimeRoot, platform, arch)) {
    addResolvedEntrypoint(runtimeRoot, entrypoints, manifestPath)
    const packageRequire = createRequire(manifestPath)
    const values = new Set()
    collectConcreteExportValues(manifest.main, values)
    collectConcreteExportValues(manifest.module, values)
    collectConcreteExportValues(manifest.bin, values)
    for (const value of values) {
      const target = path.resolve(directory, value)
      const relative = path.relative(directory, target)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`DSH runtime entrypoint escaped package root: ${name}:${value}`)
      }
      let resolvedTarget = target
      try {
        resolvedTarget = packageRequire.resolve(target)
      } catch {
        // Keep the direct file path for ESM-only entries that Node's CJS resolver cannot inspect.
      }
      addResolvedEntrypoint(runtimeRoot, entrypoints, resolvedTarget)
    }

    const specifiers = new Set()
    collectExportSpecifiers(manifest.exports, name, specifiers)
    for (const specifier of specifiers) {
      try {
        addResolvedEntrypoint(runtimeRoot, entrypoints, packageRequire.resolve(specifier))
      } catch (error) {
        if (
          error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
          error?.code === 'ERR_REQUIRE_ESM' ||
          error?.code === 'MODULE_NOT_FOUND'
        )
          continue
        throw new Error(`Unable to resolve DSH runtime entrypoint ${specifier}`, { cause: error })
      }
    }
  }
  return [...entrypoints].sort()
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function runtimeVersion({ projectRoot, platform, arch, packages, artifact }) {
  const lockfile = path.join(projectRoot, 'pnpm-lock.yaml')
  const input = {
    filterVersion: DSH_RUNTIME_FILTER_VERSION,
    platform,
    arch,
    lockfileSha256: fs.existsSync(lockfile) ? fileHash(lockfile) : null,
    packages: packages
      .map(({ manifestPath, manifest, name }) => ({
        name,
        manifestSha256: fileHash(manifestPath),
        version: manifest.version
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    files: artifact.files.map(({ path: filePath, sha256, size, mode }) => ({ path: filePath, sha256, size, mode })),
    entrypoints: artifact.entrypoints,
    archiveSha256: artifact.archiveSha256
  }
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

async function bundleDshRuntimeTree({ projectRoot, runtimeRoot, outputDir, platform, arch }) {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const packages = collectRuntimePackages(runtimeRoot, platform, arch)
  const entrypoints = collectRuntimeEntrypoints(runtimeRoot, platform, arch)
  const artifact = await bundleTreeArtifact({
    version: 'pending',
    rootDir: runtimeRoot,
    archive: DSH_RUNTIME_ARCHIVE,
    entrypoints,
    outputDir,
    stripRoot: true
  })
  artifact.version = runtimeVersion({ projectRoot, platform, arch, packages, artifact })
  writeManifest(outputDir, { schemaVersion: 2, platform, arch, artifacts: { 'dsh-runtime': artifact } })
  return { artifact, packageNames: packages.map(({ name }) => name).filter(Boolean) }
}

function retainRuntimeVariant(outputRoot, currentVariant) {
  if (!fs.existsSync(outputRoot)) return
  for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (entry.name === currentVariant) continue
    fs.rmSync(path.join(outputRoot, entry.name), { recursive: true, force: true })
  }
}

async function buildDshRuntimePackage({ platform, arch, ...options }) {
  const target = `${platform}-${arch}`
  if (!DSH_RUNTIME_TARGETS.has(target)) throw new Error(`Unsupported DSH runtime target: ${target}`)
  const projectRoot = options.projectRoot ?? path.join(__dirname, '..', '..')
  const packageRoot = options.packageRoot ?? path.join(__dirname, '..')
  const outputRoot = options.outputRoot ?? path.join(packageRoot, 'dist', 'runtime')
  // The installed workspace graph is already lockfile-resolved; re-running pnpm deploy would require uncached registry metadata.
  const sourceRoot = options.sourceRoot ?? options.deployRoot ?? packageRoot
  const runtimeRoot = options.runtimeRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-dsh-runtime-'))
  const ownsRuntimeRoot = options.runtimeRoot === undefined

  try {
    if (!fs.existsSync(path.join(sourceRoot, 'package.json'))) {
      throw new Error(`Missing installed DSH bridge package: ${path.join(sourceRoot, 'package.json')}`)
    }
    const packageNames = new Set(collectDshRuntimePackageNames(projectRoot))
    fs.mkdirSync(path.join(runtimeRoot, 'node_modules', '@cherrystudio', 'dsh-bridge'), { recursive: true })
    fs.writeFileSync(
      path.join(runtimeRoot, 'package.json'),
      JSON.stringify({ name: 'cherry-studio-dsh-runtime', private: true, type: 'module' })
    )

    const bridgeRoot = path.join(runtimeRoot, 'node_modules', '@cherrystudio', 'dsh-bridge')
    copyRuntimePackageGraph(
      sourceRoot,
      bridgeRoot,
      'node_modules/@cherrystudio/dsh-bridge',
      { platform, arch, packageNames },
      {
        rootPackages: new Map(),
        runtimeRoot,
        visited: new Set()
      }
    )

    retainRuntimeVariant(outputRoot, `${platform}-${arch}`)
    return await bundleDshRuntimeTree({
      projectRoot,
      runtimeRoot,
      outputDir: path.join(outputRoot, `${platform}-${arch}`),
      platform,
      arch
    })
  } finally {
    if (ownsRuntimeRoot) fs.rmSync(runtimeRoot, { recursive: true, force: true })
  }
}

module.exports = {
  DSH_RUNTIME_FILTER_VERSION,
  DSH_RUNTIME_PACKAGE,
  DSH_RUNTIME_TARGETS,
  buildDshRuntimePackage,
  bundleDshRuntimeTree,
  collectDshRuntimePackageNames,
  collectRuntimeEntrypoints,
  dshRuntimePackageExcludeNames,
  dshRuntimePackageExcludeFilters,
  isForeignNativePath,
  shouldKeepRuntimePath
}
