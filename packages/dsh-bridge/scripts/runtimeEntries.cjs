const crypto = require('node:crypto')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')

const DSH_BRIDGE_PACKAGE = '@cherrystudio/dsh-bridge'
const DEFAULT_RUNTIME_ENTRY_SPECIFIERS = Object.keys(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime-entrypoints.json'), 'utf8'))
)
const RUNTIME_CODE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs'])
const NATIVE_EXTENSIONS = new Set(['.dll', '.dylib', '.exe', '.node', '.so', '.wasm'])
const NATIVE_FILE_NAMES = new Set(['landlock-run', 'spawn-helper'])
const PLATFORM_TOKENS = new Set([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'linux',
  'linuxmusl',
  'openbsd',
  'sunos',
  'win10',
  'win32',
  'windows'
])
const ARCH_TOKENS = new Set(['arm64', 'arm', 'ia32', 'loong64', 'ppc64le', 'riscv64', 's390x', 'x64', 'x86'])
const SKIPPED_EXPORT_CONDITIONS = new Set(['types', 'source'])
const NON_RUNTIME_DIRECTORIES = new Set([
  '.git',
  '.github',
  '__tests__',
  'coverage',
  'dist',
  'examples',
  'scripts',
  'src',
  'test',
  'tests'
])

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function runtimeEntryFileName(specifier) {
  if (specifier === `${DSH_BRIDGE_PACKAGE}/plugin`) return 'cherry-bridge.mjs'
  const slug =
    specifier
      .replace(/^@/, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'entry'
  const digest = crypto.createHash('sha1').update(specifier).digest('hex').slice(0, 12)
  return `${slug}-${digest}.mjs`
}

function isDshRuntimePackage(name) {
  return name === DSH_BRIDGE_PACKAGE || name.startsWith('@deepseek-ai/dsh-')
}

function isNativeFilePath(relativePath) {
  return (
    NATIVE_EXTENSIONS.has(path.extname(relativePath).toLowerCase()) ||
    NATIVE_FILE_NAMES.has(path.basename(relativePath).toLowerCase())
  )
}

function isForeignNativePath(relativePath, platform, arch, packageName = '') {
  if (!platform || !arch) return false
  const match = `${normalizePath(packageName)}/${normalizePath(relativePath)}`.match(
    /(?:^|[/_-])(aix|android|darwin|freebsd|linuxmusl|linux|openbsd|sunos|win10|win32|windows)[-_](arm64|arm|ia32|loong64|ppc64le|riscv64|s390x|x64|x86)(?:[/_-]|$)/i
  )
  if (!match) return false
  const targetPlatform = match[1].toLowerCase()
  const targetArch = match[2].toLowerCase()
  const platformMatches =
    platform === 'win32' ? ['win32', 'windows', 'win10'].includes(targetPlatform) : targetPlatform === platform
  return !platformMatches || targetArch !== arch
}

function dependencyNames(manifest, includePeers = true) {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...(includePeers ? Object.keys(manifest.peerDependencies ?? {}) : []),
    ...(Array.isArray(manifest.bundledDependencies)
      ? manifest.bundledDependencies
      : Array.isArray(manifest.bundleDependencies)
        ? manifest.bundleDependencies
        : [])
  ]
}

function resolvePackageManifest(packageName, require_) {
  for (const searchPath of require_.resolve.paths(packageName) ?? []) {
    const candidate = path.join(searchPath, ...packageName.split('/'), 'package.json')
    if (!fs.existsSync(candidate)) continue
    const manifestPath = fs.realpathSync(candidate)
    return { manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) }
  }
  return undefined
}

function collectPackageGraph(packageRoot) {
  const rootManifestPath = path.join(packageRoot, 'package.json')
  const records = []
  const visited = new Set()

  const visit = (manifestPath, manifestOverride) => {
    const realManifestPath = fs.realpathSync(manifestPath)
    if (visited.has(realManifestPath)) return
    visited.add(realManifestPath)
    const manifest = manifestOverride ?? JSON.parse(fs.readFileSync(realManifestPath, 'utf8'))
    const record = {
      directory: path.dirname(realManifestPath),
      manifestPath: realManifestPath,
      manifest,
      name: manifest.name ?? ''
    }
    records.push(record)
    const packageRequire = createRequire(realManifestPath)
    for (const dependencyName of dependencyNames(manifest)) {
      const optional = Boolean(
        manifest.optionalDependencies?.[dependencyName] || manifest.peerDependenciesMeta?.[dependencyName]?.optional
      )
      const resolved = resolvePackageManifest(dependencyName, packageRequire)
      if (!resolved) {
        if (optional) continue
        throw new Error(`Missing DSH runtime dependency ${dependencyName} required by ${manifest.name}`)
      }
      visit(resolved.manifestPath, resolved.manifest)
    }
  }

  const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'))
  visit(rootManifestPath, rootManifest)
  return records
}

function resolvePackageTarget(record, value) {
  if (typeof value !== 'string' || value.includes('*')) return undefined
  const target = path.resolve(record.directory, value)
  const relative = path.relative(record.directory, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`DSH runtime entrypoint escaped package root: ${record.name}:${value}`)
  }
  try {
    const resolved = fs.realpathSync(target)
    return fs.statSync(resolved).isFile() ? resolved : undefined
  } catch {
    try {
      const resolved = fs.realpathSync(createRequire(record.manifestPath).resolve(target))
      return fs.statSync(resolved).isFile() ? resolved : undefined
    } catch {
      return undefined
    }
  }
}

function isRuntimeCodePath(filePath) {
  return RUNTIME_CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function collectExportTargets(value, packageName, specifier, output, conditions = []) {
  if (typeof value === 'string') {
    if (!value.includes('*') && !conditions.some((condition) => SKIPPED_EXPORT_CONDITIONS.has(condition))) {
      output.push({ specifier, value })
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExportTargets(item, packageName, specifier, output, conditions)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('.')) {
      if (key.includes('*')) continue
      const subpath = key.slice(2)
      if (subpath === 'package.json' || subpath === 'types' || subpath.endsWith('/types')) continue
      const childSpecifier = key === '.' ? packageName : `${packageName}${key.slice(1)}`
      collectExportTargets(item, packageName, childSpecifier, output, conditions)
    } else if (!SKIPPED_EXPORT_CONDITIONS.has(key) && !key.endsWith('/source')) {
      collectExportTargets(item, packageName, specifier, output, [...conditions, key])
    }
  }
}

function addEntry(entries, specifier, target, allowSource = false) {
  if (!specifier || entries.has(specifier)) return
  const extension = path.extname(target).toLowerCase()
  if (!RUNTIME_CODE_EXTENSIONS.has(extension) && !(allowSource && extension === '.ts')) return
  entries.set(specifier, target)
}

function collectRuntimeEntries(packageRoot, records, requestedSpecifiers = DEFAULT_RUNTIME_ENTRY_SPECIFIERS) {
  const allEntries = new Map()
  addEntry(allEntries, `${DSH_BRIDGE_PACKAGE}/plugin`, path.join(packageRoot, 'src', 'plugin.ts'), true)

  const firstByName = new Map()
  for (const record of records) {
    if (record.name && !firstByName.has(record.name)) firstByName.set(record.name, record)
  }

  for (const record of firstByName.values()) {
    if (!record.name || !isDshRuntimePackage(record.name) || record.name === DSH_BRIDGE_PACKAGE) continue
    const packageRequire = createRequire(record.manifestPath)
    const candidates = []
    if (record.manifest.exports !== undefined) {
      collectExportTargets(record.manifest.exports, record.name, record.name, candidates)
    }
    if (candidates.length === 0) {
      for (const value of [record.manifest.module, record.manifest.main]) {
        if (typeof value === 'string') candidates.push({ specifier: record.name, value })
      }
    }
    if (typeof record.manifest.bin === 'string') {
      candidates.push({ specifier: `${record.name}/bin`, value: record.manifest.bin })
    } else if (record.manifest.bin && typeof record.manifest.bin === 'object') {
      for (const [binName, value] of Object.entries(record.manifest.bin)) {
        if (typeof value === 'string') candidates.push({ specifier: `${record.name}/${binName}`, value })
      }
    }
    for (const candidate of candidates) {
      let target = resolvePackageTarget(record, candidate.value)
      if (!target) {
        try {
          target = fs.realpathSync(packageRequire.resolve(candidate.specifier))
        } catch {
          continue
        }
      }
      if (target && isRuntimeCodePath(target)) addEntry(allEntries, candidate.specifier, target)
    }
  }
  const entries = new Map()
  for (const specifier of requestedSpecifiers) {
    const target = allEntries.get(specifier)
    if (!target) throw new Error(`Missing configured DSH runtime entry ${specifier}`)
    entries.set(specifier, target)
  }
  return entries
}

function walkFiles(root, callback) {
  if (!fs.existsSync(root)) return
  for (const entry of fs
    .readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) walkFiles(absolute, callback)
    else if (entry.isFile()) callback(absolute)
  }
}

function packageHasRuntimeSidecar(record, platform, arch) {
  let sidecar = false
  walkFiles(record.directory, (filePath) => {
    if (sidecar) return
    const relative = normalizePath(path.relative(record.directory, filePath))
    if (relative.split('/').some((segment) => NON_RUNTIME_DIRECTORIES.has(segment))) return
    if (isNativeFilePath(relative) && !isForeignNativePath(relative, platform, arch, record.name)) sidecar = true
  })
  if (sidecar) return true
  const optionalNames = Object.keys(record.manifest.optionalDependencies ?? {})
  return optionalNames.some((name) => {
    const tokens = normalizePath(name).split(/[-_/]/).filter(Boolean)
    return tokens.some((token) => PLATFORM_TOKENS.has(token) || ARCH_TOKENS.has(token))
  })
}

function collectRuntimeResolutionPackages(records) {
  const available = new Set(records.map((record) => record.name).filter(Boolean))
  const packages = new Set()
  for (const record of records) {
    walkFiles(record.directory, (filePath) => {
      const relative = normalizePath(path.relative(record.directory, filePath))
      if (relative.split('/').some((segment) => NON_RUNTIME_DIRECTORIES.has(segment))) return
      if (!isRuntimeCodePath(filePath)) return
      const source = fs.readFileSync(filePath, 'utf8')
      const pattern = /import\.meta\.resolve\(\s*(['"])([^'"]+)\1\s*\)/g
      for (const match of source.matchAll(pattern)) {
        const packageName = packageNameFromSpecifier(match[2])
        if (packageName !== record.name && available.has(packageName)) packages.add(packageName)
      }
    })
  }
  return packages
}

function expandExternalPackages(records, roots) {
  const recordsByName = new Map()
  for (const record of records) {
    if (!record.name) continue
    const list = recordsByName.get(record.name) ?? []
    list.push(record)
    recordsByName.set(record.name, list)
  }
  const names = new Set(roots)
  const queue = [...names]
  while (queue.length > 0) {
    const name = queue.pop()
    for (const record of recordsByName.get(name) ?? []) {
      for (const dependencyName of dependencyNames(record.manifest, false)) {
        if (!names.has(dependencyName) && recordsByName.has(dependencyName)) {
          names.add(dependencyName)
          queue.push(dependencyName)
        }
      }
    }
  }
  return names
}

function collectForeignNativePaths(records, platform, arch) {
  const paths = []
  for (const record of records) {
    walkFiles(record.directory, (filePath) => {
      const relative = normalizePath(path.relative(record.directory, filePath))
      if (!isNativeFilePath(relative)) return
      if (!isForeignNativePath(relative, platform, arch, record.name)) return
      paths.push({ packageName: record.name, relative })
    })
  }
  return paths.sort((left, right) =>
    `${left.packageName}/${left.relative}`.localeCompare(`${right.packageName}/${right.relative}`)
  )
}

function collectForeignOnlyPackages(records, platform, arch) {
  if (!platform || !arch) return new Set()
  const foreignOnly = new Set()
  for (const record of records) {
    const nativeFiles = []
    walkFiles(record.directory, (filePath) => {
      const relative = normalizePath(path.relative(record.directory, filePath))
      if (isNativeFilePath(relative)) nativeFiles.push(relative)
    })
    if (
      nativeFiles.length > 0 &&
      nativeFiles.every((relative) => isForeignNativePath(relative, platform, arch, record.name))
    ) {
      foreignOnly.add(record.name)
    }
  }
  return foreignOnly
}

function discoverDshRuntimePackaging({
  packageRoot,
  platform = process.platform,
  arch = process.arch,
  entrySpecifiers = DEFAULT_RUNTIME_ENTRY_SPECIFIERS
} = {}) {
  const resolvedPackageRoot = packageRoot ?? path.join(__dirname, '..')
  const records = collectPackageGraph(resolvedPackageRoot)
  const entries = collectRuntimeEntries(resolvedPackageRoot, records, entrySpecifiers)
  const externalRoots = new Set(
    records
      .filter((record) => record.name && packageHasRuntimeSidecar(record, platform, arch))
      .map((record) => record.name)
  )
  for (const packageName of collectRuntimeResolutionPackages(records)) externalRoots.add(packageName)
  const foreignOnlyPackages = collectForeignOnlyPackages(records, platform, arch)
  const externalPackageNames = expandExternalPackages(records, externalRoots)
  for (const packageName of foreignOnlyPackages) externalPackageNames.delete(packageName)
  const manifestEntries = Object.fromEntries(
    [...entries.keys()].sort().map((specifier) => [specifier, runtimeEntryFileName(specifier)])
  )
  const entry = Object.fromEntries(
    [...entries.entries()].map(([specifier, sourcePath]) => [
      runtimeEntryFileName(specifier).replace(/\.mjs$/, ''),
      sourcePath
    ])
  )
  return {
    entry,
    entries: manifestEntries,
    dshPackageNames: [
      ...new Set(
        records.filter((record) => record.name && isDshRuntimePackage(record.name)).map((record) => record.name)
      )
    ].sort(),
    externalPackageNames: [...externalPackageNames].sort(),
    foreignNativePaths: collectForeignNativePaths(records, platform, arch),
    packageRecords: records
  }
}

module.exports = {
  DSH_BRIDGE_PACKAGE,
  DEFAULT_RUNTIME_ENTRY_SPECIFIERS,
  discoverDshRuntimePackaging,
  isDshRuntimePackage,
  isForeignNativePath,
  packageHasRuntimeSidecar,
  packageNameFromSpecifier,
  isNativeFilePath,
  runtimeEntryFileName
}
