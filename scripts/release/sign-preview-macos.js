const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { notarize } = require('@electron/notarize')
const { signAsync } = require('@electron/osx-sign')
const semver = require('semver')

const BUNDLE_PRODUCTS = new Map([
  ['com.kangfenmao.CherryStudio', 'Cherry-Studio'],
  ['com.cherryai.cherrystudio.cn', 'Cherry-Studio-CN']
])

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' })?.trim()
}

function assertMetadata(metadata) {
  if (!['arm64', 'x64'].includes(metadata.arch)) throw new Error(`Unsupported macOS architecture: ${metadata.arch}`)
  if (!/^[0-9a-f]{40}$/.test(metadata.sourceSha)) throw new Error('Invalid preview source SHA')
  if (!/^[0-9a-f]{64}$/.test(metadata.archiveSha256)) throw new Error('Invalid preview archive digest')
  if (!/^preview-[A-Za-z0-9._-]+-[0-9a-f]{12}$/.test(metadata.previewTag)) {
    throw new Error('Invalid preview release tag')
  }
  if (!metadata.previewTag.endsWith(metadata.sourceSha.slice(0, 12))) {
    throw new Error('Preview tag does not match its source SHA')
  }
  if (!semver.valid(metadata.version)) throw new Error('Invalid preview version')
  if (!BUNDLE_PRODUCTS.has(metadata.bundleId))
    throw new Error(`Unsupported application bundle ID: ${metadata.bundleId}`)
  if (path.basename(metadata.archive) !== metadata.archive || !metadata.archive.endsWith('.zip')) {
    throw new Error('Invalid preview archive name')
  }
  return metadata
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function validateArchiveEntries(archivePath) {
  const entries = command('unzip', ['-Z1', archivePath], { capture: true }).split('\n').filter(Boolean)
  if (entries.length === 0) throw new Error(`Empty preview archive: ${archivePath}`)
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.split('/').includes('..'))
      throw new Error(`Unsafe preview archive entry: ${entry}`)
  }
}

function readPlist(infoPath, key) {
  return command('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPath], { capture: true })
}

function getSigningIdentity() {
  const identities = command('security', ['find-identity', '-v', '-p', 'codesigning'], { capture: true })
  const match = identities.match(/"(Developer ID Application: [^"]+)"/)
  if (!match) throw new Error('No Developer ID Application identity is available')
  return match[1]
}

function getApplicationArchitecture(appPath) {
  const executableName = readPlist(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleExecutable')
  const architectures = command('lipo', ['-archs', path.join(appPath, 'Contents', 'MacOS', executableName)], {
    capture: true
  }).split(/\s+/)
  if (architectures.length !== 1) throw new Error(`Expected a single-architecture preview app, found ${architectures}`)
  return architectures[0] === 'x86_64' ? 'x64' : architectures[0]
}

function loadPayloads(inputDirectory) {
  const metadataFiles = []
  for (const artifactDirectory of fs.readdirSync(inputDirectory, { withFileTypes: true })) {
    if (!artifactDirectory.isDirectory()) continue
    const artifactPath = path.join(inputDirectory, artifactDirectory.name)
    for (const fileName of fs.readdirSync(artifactPath)) {
      if (fileName.endsWith('.json')) metadataFiles.push(path.join(artifactPath, fileName))
    }
  }
  if (metadataFiles.length === 0) throw new Error('No preview signing metadata found')
  return metadataFiles.sort().map((metadataFile) => ({
    directory: path.dirname(metadataFile),
    metadata: assertMetadata(JSON.parse(fs.readFileSync(metadataFile, 'utf8')))
  }))
}

async function signPayload(payload, outputDirectory, identity) {
  const { directory, metadata } = payload
  const archivePath = path.join(directory, metadata.archive)
  if (sha256(archivePath) !== metadata.archiveSha256) throw new Error(`Preview archive digest mismatch: ${archivePath}`)
  validateArchiveEntries(archivePath)

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-preview-signing-'))
  try {
    command('ditto', ['-x', '-k', archivePath, temporaryDirectory])
    const appNames = fs.readdirSync(temporaryDirectory).filter((name) => name.endsWith('.app'))
    if (appNames.length !== 1) throw new Error(`Expected one macOS application in ${archivePath}`)

    const appPath = path.join(temporaryDirectory, appNames[0])
    const infoPath = path.join(appPath, 'Contents', 'Info.plist')
    if (readPlist(infoPath, 'CFBundleIdentifier') !== metadata.bundleId) {
      throw new Error(`Application bundle ID does not match ${archivePath}`)
    }
    if (getApplicationArchitecture(appPath) !== metadata.arch) {
      throw new Error(`Application architecture does not match ${archivePath}`)
    }

    const entitlements = path.resolve('build/entitlements.mac.plist')
    await signAsync({
      app: appPath,
      identity,
      platform: 'darwin',
      strictVerify: true,
      type: 'distribution',
      optionsForFile: () => ({ entitlements, hardenedRuntime: true })
    })
    await notarize({
      appBundleId: metadata.bundleId,
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    })

    command('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    command('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
    command('xcrun', ['stapler', 'validate', appPath])

    const baseName = `${BUNDLE_PRODUCTS.get(metadata.bundleId)}-${metadata.version}-mac-${metadata.arch}`
    command('ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      appPath,
      path.join(outputDirectory, `${baseName}.zip`)
    ])

    const dmgDirectory = path.join(temporaryDirectory, 'dmg')
    fs.mkdirSync(dmgDirectory)
    command('ditto', [appPath, path.join(dmgDirectory, path.basename(appPath))])
    fs.symlinkSync('/Applications', path.join(dmgDirectory, 'Applications'))
    const dmgPath = path.join(outputDirectory, `${baseName}.dmg`)
    command('hdiutil', [
      'create',
      '-volname',
      path.basename(appPath, '.app'),
      '-srcfolder',
      dmgDirectory,
      '-ov',
      '-format',
      'UDZO',
      dmgPath
    ])
    command('codesign', ['--force', '--sign', identity, '--timestamp', dmgPath])
    command('codesign', ['--verify', '--verbose=2', dmgPath])
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

async function main() {
  const [inputDirectory, outputDirectory] = process.argv.slice(2)
  if (!inputDirectory || !outputDirectory) {
    throw new Error('Usage: node scripts/release/sign-preview-macos.js <input-directory> <output-directory>')
  }
  for (const variable of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!process.env[variable]) throw new Error(`Missing ${variable}`)
  }

  const payloads = loadPayloads(path.resolve(inputDirectory))
  const releaseTags = new Set(payloads.map(({ metadata }) => metadata.previewTag))
  const payloadKeys = new Set(payloads.map(({ metadata }) => `${metadata.bundleId}:${metadata.arch}`))
  if (releaseTags.size !== 1) throw new Error('Preview signing payloads target different releases')
  if (payloadKeys.size !== payloads.length) throw new Error('Duplicate preview signing payload')

  fs.mkdirSync(outputDirectory, { recursive: true })
  const identity = getSigningIdentity()
  for (const payload of payloads) await signPayload(payload, path.resolve(outputDirectory), identity)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
