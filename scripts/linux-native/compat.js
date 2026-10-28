const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const MANIFEST_SCHEMA_VERSION = 2
const VERSION_LIMITS = Object.freeze({
  glibc: '2.28',
  glibcxx: '3.4.25',
  cxxabi: '1.3.11'
})
const ARCH_TO_ELF_MACHINE = Object.freeze({
  x64: 62,
  arm64: 183
})
const ELF_MACHINE_TO_ARCH = new Map(Object.entries(ARCH_TO_ELF_MACHINE).map(([arch, machine]) => [machine, arch]))
const ARTIFACT_CACHE_RELATIVE_PATH = path.join('scripts', 'linux-native', 'prebuilt')
const NATIVE_MODULE_RELATIVE_PATH = path.join(
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
)

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }

  return 0
}

function parseVersionRequirements(text) {
  const requirements = {
    glibc: null,
    glibcxx: null,
    cxxabi: null
  }
  const familyToKey = {
    GLIBC: 'glibc',
    GLIBCXX: 'glibcxx',
    CXXABI: 'cxxabi'
  }
  const pattern = /\b(GLIBCXX|GLIBC|CXXABI)_(\d+(?:\.\d+)+)\b/g

  for (const match of text.matchAll(pattern)) {
    const key = familyToKey[match[1]]
    const version = match[2]
    if (requirements[key] === null || compareVersions(version, requirements[key]) > 0) {
      requirements[key] = version
    }
  }

  return requirements
}

function assertVersionRequirements(requirements) {
  for (const [family, limit] of Object.entries(VERSION_LIMITS)) {
    const required = requirements[family]
    if (required !== null && compareVersions(required, limit) > 0) {
      throw new Error(`better-sqlite3 requires ${family.toUpperCase()}_${required}, exceeding the ${limit} limit`)
    }
  }
}

function detectElfArch(buffer) {
  if (buffer.length < 20 || !buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error('better-sqlite3 artifact is not an ELF binary')
  }
  if (buffer[4] !== 2) {
    throw new Error('better-sqlite3 artifact must be a 64-bit ELF binary')
  }
  if (buffer[5] !== 1) {
    throw new Error('better-sqlite3 artifact must be a little-endian ELF binary')
  }

  const machine = buffer.readUInt16LE(18)
  const arch = ELF_MACHINE_TO_ARCH.get(machine)
  if (!arch) {
    throw new Error(`Unsupported better-sqlite3 ELF machine: ${machine}`)
  }
  return arch
}

function inspectNativeAddon(addonPath) {
  const buffer = fs.readFileSync(addonPath)
  return {
    arch: detectElfArch(buffer),
    requirements: parseVersionRequirements(buffer.toString('latin1')),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  }
}

function getNativeArtifactPaths(projectRoot, arch) {
  const outputDir = path.join(projectRoot, ARTIFACT_CACHE_RELATIVE_PATH, arch)
  return {
    outputDir,
    addonPath: path.join(outputDir, 'better_sqlite3.node'),
    manifestPath: path.join(outputDir, 'manifest.json')
  }
}

function assertManifestField(manifest, field, expected) {
  if (manifest[field] !== expected) {
    throw new Error(
      `Incompatible better-sqlite3 manifest field ${field}: expected ${expected}, found ${manifest[field]}`
    )
  }
}

function verifyNativeArtifact({ addonPath, manifestPath, expected }) {
  if (!fs.existsSync(addonPath)) {
    throw new Error(`Missing compatible better-sqlite3 artifact: ${addonPath}`)
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing compatible better-sqlite3 manifest: ${manifestPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assertManifestField(manifest, 'schemaVersion', MANIFEST_SCHEMA_VERSION)
  assertManifestField(manifest, 'platform', 'linux')
  for (const field of ['arch', 'electronVersion', 'electronAbi', 'betterSqlite3Version']) {
    assertManifestField(manifest, field, expected[field])
  }

  const inspection = inspectNativeAddon(addonPath)
  if (inspection.arch !== expected.arch) {
    throw new Error(`Expected a ${expected.arch} better-sqlite3 artifact, found ${inspection.arch}`)
  }
  assertVersionRequirements(inspection.requirements)

  if (inspection.sha256 !== manifest.sha256) {
    throw new Error(
      `better-sqlite3 artifact checksum mismatch: expected ${manifest.sha256}, found ${inspection.sha256}`
    )
  }
  if (JSON.stringify(inspection.requirements) !== JSON.stringify(manifest.requirements)) {
    throw new Error('better-sqlite3 manifest version requirements do not match the artifact')
  }

  return { manifest, inspection }
}

function replacePackagedBetterSqlite3({ projectRoot, appOutDir, arch, metadata }) {
  const artifactPaths = getNativeArtifactPaths(projectRoot, arch)
  const expected = { ...metadata, arch }
  const verified = verifyNativeArtifact({ ...artifactPaths, expected })
  const destination = path.join(appOutDir, NATIVE_MODULE_RELATIVE_PATH)

  if (!fs.existsSync(destination)) {
    throw new Error(`Packaged better-sqlite3 artifact is missing: ${destination}`)
  }

  fs.copyFileSync(artifactPaths.addonPath, destination)
  fs.chmodSync(destination, fs.statSync(artifactPaths.addonPath).mode & 0o777)
  verifyNativeArtifact({
    addonPath: destination,
    manifestPath: artifactPaths.manifestPath,
    expected
  })

  return {
    destination,
    manifest: verified.manifest
  }
}

function readInstalledPackageVersion(projectRoot, packageName) {
  const packagePath = path.join(projectRoot, 'node_modules', ...packageName.split('/'), 'package.json')
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Missing installed package ${packageName}; run pnpm install before packaging`)
  }
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version
}

function resolveElectronAbi(projectRoot, electronVersion) {
  const rebuildEntry = require.resolve('@electron/rebuild', { paths: [projectRoot] })
  const rebuildRequire = createRequire(rebuildEntry)
  return String(rebuildRequire('node-abi').getAbi(electronVersion, 'electron'))
}

function readProjectBuildMetadata(projectRoot) {
  const electronVersion = readInstalledPackageVersion(projectRoot, 'electron')
  return {
    electronVersion,
    electronAbi: resolveElectronAbi(projectRoot, electronVersion),
    betterSqlite3Version: readInstalledPackageVersion(projectRoot, 'better-sqlite3')
  }
}

module.exports = {
  ARCH_TO_ELF_MACHINE,
  getNativeArtifactPaths,
  parseVersionRequirements,
  readProjectBuildMetadata,
  replacePackagedBetterSqlite3,
  verifyNativeArtifact
}
