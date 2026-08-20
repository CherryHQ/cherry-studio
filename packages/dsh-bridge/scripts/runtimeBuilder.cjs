const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const { builtinModules, createRequire } = require('module')
const path = require('path')
const { pathToFileURL } = require('url')

const { bundleTreeArtifact, writeManifest } = require('../../../scripts/download-binaries')

const DSH_RUNTIME_PACKAGE = '@cherrystudio/dsh-bridge'
const DSH_RUNTIME_FILTER_VERSION = 9
const DSH_RUNTIME_ARCHIVE = 'dsh-runtime.tar.zst'
const DSH_RUNTIME_BUNDLE_DIRECTORY = '.cherry-runtime'
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
const DSH_RUNTIME_CODE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs'])
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
  if (basename === '.DS_Store') return false
  if (normalized.startsWith('node_modules/@cherrystudio/dsh-bridge/dist/runtime/')) return false
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false
  if (DSH_RUNTIME_BUILD_METADATA.test(normalized)) return false
  if (DSH_RUNTIME_BUILD_FILE_NAMES.has(basename.toLowerCase())) return false
  if (/^(?:npm-shrinkwrap\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(basename)) {
    return false
  }
  if (/^(?:README|LICENSE|CHANGELOG)(?:[._-]|$)/i.test(basename)) return false
  if (
    segments.some((segment) => segment === 'doc' || segment === 'docs') &&
    /\.(?:adoc|md|mdx|rst|txt)$/i.test(basename)
  ) {
    return false
  }
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
  if (!fs.statSync(resolved).isFile()) return
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

    const exportValues = new Set()
    collectConcreteExportValues(manifest.exports, exportValues)
    for (const value of exportValues) {
      const resolvedTarget = resolveRuntimePackageTarget({ directory, manifestPath, name }, value)
      if (resolvedTarget) addResolvedEntrypoint(runtimeRoot, entrypoints, resolvedTarget)
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

function isDshOwnedPackage(name) {
  return name === DSH_RUNTIME_PACKAGE || name.startsWith('@deepseek-ai/dsh-')
}

function resolveRuntimePackageTarget(packageRecord, value) {
  if (typeof value !== 'string' || value.includes('*')) return
  const target = path.resolve(packageRecord.directory, value)
  const relative = path.relative(packageRecord.directory, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`DSH runtime entrypoint escaped package root: ${packageRecord.name}:${value}`)
  }

  try {
    return fs.realpathSync(target)
  } catch {
    try {
      return fs.realpathSync(createRequire(packageRecord.manifestPath).resolve(target))
    } catch {
      return
    }
  }
}

function collectRuntimeBundleTargets(packageRecord) {
  const values = new Set()
  collectConcreteExportValues(packageRecord.manifest.main, values)
  collectConcreteExportValues(packageRecord.manifest.module, values)
  collectConcreteExportValues(packageRecord.manifest.bin, values)
  if (isDshOwnedPackage(packageRecord.name)) collectConcreteExportValues(packageRecord.manifest.exports, values)

  const targets = new Set()
  for (const value of values) {
    const target = resolveRuntimePackageTarget(packageRecord, value)
    if (!target || !DSH_RUNTIME_CODE_EXTENSIONS.has(path.extname(target).toLowerCase())) continue
    targets.add(target)
  }
  return [...targets].sort()
}

function bundleEntryName(packageName, sourcePath) {
  const digest = crypto.createHash('sha1').update(`${packageName}\0${sourcePath}`).digest('hex').slice(0, 12)
  return `entry-${digest}`
}

function collectRuntimeBundlePlans(packages, excludedNames = new Set()) {
  const plans = []
  for (const packageRecord of packages) {
    if (!isDshOwnedPackage(packageRecord.name) || excludedNames.has(packageRecord.name)) continue
    const entries = []
    const sourceToEntry = new Map()
    for (const sourcePath of collectRuntimeBundleTargets(packageRecord)) {
      const id = bundleEntryName(packageRecord.name, sourcePath)
      entries.push({ id, sourcePath })
      sourceToEntry.set(sourcePath, id)
    }
    if (entries.length > 0)
      plans.push({
        packageRecord,
        entries,
        sourceToEntry,
        outputDir: path.join(packageRecord.directory, DSH_RUNTIME_BUNDLE_DIRECTORY)
      })
  }
  return plans
}

let tsdownBuildPromise

async function loadTsdownBuild(packageRoot) {
  if (!tsdownBuildPromise) {
    const tsdownPath = require.resolve('tsdown', { paths: [packageRoot] })
    tsdownBuildPromise = import(pathToFileURL(tsdownPath).href).then((module) => {
      if (typeof module.build !== 'function') throw new Error(`tsdown build API is unavailable: ${tsdownPath}`)
      return module.build
    })
  }
  return tsdownBuildPromise
}

async function bundleRuntimePackage(plan, packageRoot, nativePackageNames) {
  const build = await loadTsdownBuild(packageRoot)
  fs.rmSync(plan.outputDir, { recursive: true, force: true })
  const entry = Object.fromEntries(plan.entries.map(({ id, sourcePath }) => [id, sourcePath]))
  try {
    await build({
      entry,
      outDir: plan.outputDir,
      cwd: plan.packageRecord.directory,
      workspace: false,
      tsconfig: false,
      format: ['esm'],
      dts: false,
      clean: true,
      platform: 'node',
      sourcemap: false,
      minify: false,
      treeshake: true,
      hash: false,
      external: [...nativePackageNames],
      noExternal: (id) => {
        if (id.startsWith('.') || id.startsWith('/') || NODE_BUILTIN_MODULES.has(id)) return false
        return !nativePackageNames.has(packageNameFromSpecifier(id))
      },
      logLevel: 'warn',
      outputOptions: {
        entryFileNames: '[name].mjs',
        chunkFileNames: '[name]-[hash].mjs'
      }
    })
  } catch (error) {
    throw new Error(`Unable to bundle DSH runtime package ${plan.packageRecord.name}`, { cause: error })
  }

  for (const { id } of plan.entries) {
    const outputPath = path.join(plan.outputDir, `${id}.mjs`)
    if (!fs.existsSync(outputPath)) throw new Error(`Missing DSH runtime bundle output: ${outputPath}`)
  }
}

function mapRuntimeTarget(packageRecord, value, sourceToBundle) {
  if (typeof value !== 'string' || value.includes('*')) return value
  const sourcePath = resolveRuntimePackageTarget(packageRecord, value)
  const entryId = sourcePath && sourceToBundle.get(sourcePath)
  if (!entryId) return value
  return `./${normalizeRelativePath(path.relative(packageRecord.directory, path.join(packageRecord.directory, DSH_RUNTIME_BUNDLE_DIRECTORY, `${entryId}.mjs`)))}`
}

function rewriteRuntimeManifestValue(value, packageRecord, sourceToBundle) {
  if (typeof value === 'string') return mapRuntimeTarget(packageRecord, value, sourceToBundle)
  if (Array.isArray(value)) return value.map((item) => rewriteRuntimeManifestValue(item, packageRecord, sourceToBundle))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, rewriteRuntimeManifestValue(item, packageRecord, sourceToBundle)])
  )
}

function rewriteRuntimePackageManifest(plan) {
  const packageRecord = plan.packageRecord
  const manifest = JSON.parse(fs.readFileSync(packageRecord.manifestPath, 'utf8'))
  for (const key of ['main', 'module', 'bin', 'exports']) {
    if (manifest[key] !== undefined)
      manifest[key] = rewriteRuntimeManifestValue(manifest[key], packageRecord, plan.sourceToEntry)
  }
  fs.writeFileSync(packageRecord.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function walkFiles(root, callback) {
  if (!fs.existsSync(root)) return
  for (const entry of fs
    .readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(root, entry.name)
    if (entry.isDirectory()) walkFiles(absolutePath, callback)
    else if (entry.isFile()) callback(absolutePath)
  }
}

function nativePackageNames(packages, platform, arch) {
  const result = new Set()
  for (const packageRecord of packages) {
    let hasNative = false
    walkFiles(packageRecord.directory, (filePath) => {
      if (hasNative || !DSH_RUNTIME_NATIVE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return
      const relative = normalizeRelativePath(path.relative(packageRecord.directory, filePath))
      if (relative.startsWith('node_modules/')) return
      if (!isForeignNativePath(relative, platform, arch)) hasNative = true
    })
    if (hasNative) result.add(packageRecord.name)
  }

  const parents = new Map()
  for (const packageRecord of packages) {
    for (const dependencyName of dependencyNamesFromManifest(packageRecord.manifest)) {
      const packageNames = parents.get(dependencyName) ?? new Set()
      packageNames.add(packageRecord.name)
      parents.set(dependencyName, packageNames)
    }
  }
  const queue = [...result]
  while (queue.length > 0) {
    const childName = queue.pop()
    for (const parentName of parents.get(childName) ?? []) {
      if (parentName === DSH_RUNTIME_PACKAGE) continue
      if (result.has(parentName)) continue
      result.add(parentName)
      queue.push(parentName)
    }
  }
  return result
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function collectBundleExternalPackageNames(plans, availableNames) {
  const result = new Set()
  const importPattern = /(?:\bfrom\s*|\bimport\s*|\b(?:import|export)\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g
  for (const plan of plans) {
    walkFiles(plan.outputDir, (filePath) => {
      const source = fs
        .readFileSync(filePath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1')
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]
        if (
          !specifier ||
          !/^(?:@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._@+~-]+)*$/.test(specifier) ||
          specifier.startsWith('.') ||
          specifier.startsWith('/') ||
          NODE_BUILTIN_MODULES.has(specifier)
        )
          continue
        const name = packageNameFromSpecifier(specifier)
        if (availableNames.has(name)) result.add(name)
      }
    })
  }
  return result
}

function expandPackageDependencyNames(names, packages) {
  const byName = new Map()
  for (const packageRecord of packages) {
    const records = byName.get(packageRecord.name) ?? []
    records.push(packageRecord)
    byName.set(packageRecord.name, records)
  }
  const queue = [...names]
  const visited = new Set()
  while (queue.length > 0) {
    const name = queue.pop()
    if (!name || visited.has(name)) continue
    visited.add(name)
    for (const packageRecord of byName.get(name) ?? []) {
      for (const dependencyName of dependencyNamesFromManifest(packageRecord.manifest)) {
        if (byName.has(dependencyName) && !names.has(dependencyName)) {
          names.add(dependencyName)
          queue.push(dependencyName)
        }
      }
    }
  }
}

function isRuntimeCodePath(filePath) {
  return DSH_RUNTIME_CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function pruneDshPackage(packageRecord) {
  const packageRoot = packageRecord.directory
  walkFiles(packageRoot, (filePath) => {
    const relative = normalizeRelativePath(path.relative(packageRoot, filePath))
    if (relative.startsWith('node_modules/')) return
    if (relative === 'package.json' || relative.startsWith(`${DSH_RUNTIME_BUNDLE_DIRECTORY}/`)) return
    if (!isRuntimeCodePath(filePath) && !DSH_RUNTIME_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return
    fs.rmSync(filePath, { force: true })
  })
}

function pruneRuntimeTree(packages, plans, platform, arch) {
  const availableNames = new Set(packages.map(({ name }) => name).filter(Boolean))
  const requiredNames = new Set(packages.filter(({ name }) => isDshOwnedPackage(name)).map(({ name }) => name))
  const nativeNames = nativePackageNames(packages, platform, arch)
  const externalNames = collectBundleExternalPackageNames(plans, availableNames)
  for (const name of externalNames) requiredNames.add(name)
  const dependencyRoots = new Set(nativeNames)
  for (const name of externalNames) {
    if (!isDshOwnedPackage(name)) dependencyRoots.add(name)
  }
  expandPackageDependencyNames(dependencyRoots, packages)
  for (const name of dependencyRoots) requiredNames.add(name)

  const packageDirectories = packages
    .filter(({ name }) => name && !isDshOwnedPackage(name) && !requiredNames.has(name))
    .map(({ directory }) => directory)
    .sort((left, right) => right.length - left.length)
  for (const directory of packageDirectories) fs.rmSync(directory, { recursive: true, force: true })
  const bundledNames = new Set(plans.map(({ packageRecord }) => packageRecord.name))
  for (const packageRecord of packages) {
    if (bundledNames.has(packageRecord.name)) pruneDshPackage(packageRecord)
  }
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

async function bundleDshRuntimeTree({
  projectRoot,
  packageRoot = path.join(__dirname, '..'),
  runtimeRoot,
  outputDir,
  platform,
  arch,
  pruneUnbundledPackages = false
}) {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const packages = collectRuntimePackages(runtimeRoot, platform, arch)
  const nativeNames = nativePackageNames(packages, platform, arch)
  const plans = collectRuntimeBundlePlans(packages, nativeNames)
  for (const plan of plans) {
    await bundleRuntimePackage(plan, packageRoot, nativeNames)
    rewriteRuntimePackageManifest(plan)
  }
  if (pruneUnbundledPackages) pruneRuntimeTree(packages, plans, platform, arch)

  const finalPackages = collectRuntimePackages(runtimeRoot, platform, arch)
  const entrypoints = collectRuntimeEntrypoints(runtimeRoot, platform, arch)
  const artifact = await bundleTreeArtifact({
    version: 'pending',
    rootDir: runtimeRoot,
    archive: DSH_RUNTIME_ARCHIVE,
    entrypoints,
    outputDir,
    stripRoot: true
  })
  artifact.version = runtimeVersion({ projectRoot, platform, arch, packages: finalPackages, artifact })
  writeManifest(outputDir, { schemaVersion: 2, platform, arch, artifacts: { 'dsh-runtime': artifact } })
  return { artifact, packageNames: finalPackages.map(({ name }) => name).filter(Boolean) }
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
      packageRoot,
      runtimeRoot,
      outputDir: path.join(outputRoot, `${platform}-${arch}`),
      platform,
      arch,
      pruneUnbundledPackages: options.pruneUnbundledPackages ?? true
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
