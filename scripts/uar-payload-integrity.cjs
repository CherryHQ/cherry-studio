const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const UAR_VERSION_MARKER = '.uar-sidecar-version'

function loadUarArtifactManifest() {
  const integration = require(path.join(PROJECT_ROOT, 'build', 'integration-artifacts.json'))
  const sidecar = integration.tools.find((tool) => tool.name === 'uar-sidecar')
  if (!sidecar) throw new Error('Integration artifact manifest is missing uar-sidecar')
  return { integration, sidecar }
}

function getUarPayloadInventory(platformKey) {
  const { sidecar } = loadUarArtifactManifest()
  const platformFamily = platformKey.split('-')[0]
  const exact = sidecar.packages?.[platformKey]
  const packages = exact
    ? [exact]
    : Object.entries(sidecar.packages || {})
        .filter(([candidate]) => candidate.startsWith(`${platformFamily}-`))
        .map(([, artifact]) => artifact)
  return [...new Set([...packages.flatMap((artifact) => artifact.binaries || []), UAR_VERSION_MARKER])].sort()
}

function getPackagedBinaryDirectory(resourcesDir, platformKey) {
  return path.join(resourcesDir, 'app.asar.unpacked', 'resources', 'binaries', platformKey)
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
}

function isSafeRelativePath(filename) {
  if (!filename || path.posix.isAbsolute(filename) || filename.includes('\\')) return false
  const normalized = path.posix.normalize(filename)
  return normalized === filename && normalized !== '..' && !normalized.startsWith('../')
}

function isPlatformSignedCode(filename, platformKey) {
  if (platformKey.startsWith('darwin-')) return filename === 'uar-sidecar' || filename.endsWith('.dylib')
  if (platformKey.startsWith('win32-')) return filename === 'uar-sidecar.exe'
  return false
}

function verifyPlatformSignature(filename, platformKey) {
  const result = platformKey.startsWith('darwin-')
    ? spawnSync('codesign', ['--verify', '--strict', '--verbose=2', filename], { encoding: 'utf8' })
    : spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-AuthenticodeSignature -LiteralPath $env:UAR_SIGNED_FILE).Status'
        ],
        { env: { ...process.env, UAR_SIGNED_FILE: filename }, encoding: 'utf8', windowsHide: true }
      )
  const valid = platformKey.startsWith('darwin-')
    ? result.status === 0
    : result.status === 0 && result.stdout.trim() === 'Valid'
  if (!valid) {
    throw new Error(`Packaged UAR sidecar platform signature is invalid for ${platformKey}: ${path.basename(filename)}`)
  }
}

function verifyPackagedUarPayload(resourcesDir, platformKey, options = {}) {
  const { integration, sidecar } = loadUarArtifactManifest()
  const expected = sidecar?.packages?.[platformKey]
  if (!expected) throw new Error(`Integration artifact manifest is missing uar-sidecar ${platformKey}`)

  const payloadDir = getPackagedBinaryDirectory(resourcesDir, platformKey)
  const manifestFile = path.join(payloadDir, 'payload-manifest.json')
  const manifestStat = fs.statSync(manifestFile, { throwIfNoEntry: false })
  if (!manifestStat?.isFile() || manifestStat.size === 0) {
    throw new Error(`Packaged UAR sidecar manifest is missing or empty for ${platformKey}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  if (
    manifest.schema !== 1 ||
    manifest.name !== 'uar-sidecar' ||
    manifest.version !== sidecar.version ||
    manifest.platform !== platformKey ||
    manifest.source !== integration.sources.uar.revision ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error(`Packaged UAR sidecar manifest identity does not match the release pins for ${platformKey}`)
  }

  const declaredFiles = manifest.files.map((entry) => entry.path).sort()
  const expectedFiles = expected.binaries.filter((filename) => filename !== 'payload-manifest.json').sort()
  if (JSON.stringify(declaredFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Packaged UAR sidecar file inventory does not match the release pins for ${platformKey}`)
  }

  for (const entry of manifest.files) {
    if (
      !isSafeRelativePath(entry.path) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`Invalid UAR sidecar manifest entry for ${platformKey}: ${entry.path || '<missing path>'}`)
    }
    const filename = path.join(payloadDir, ...entry.path.split('/'))
    const stat = fs.statSync(filename, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.size === 0) {
      throw new Error(`Packaged UAR sidecar file is missing or truncated for ${platformKey}: ${entry.path}`)
    }
    const payloadMatches = stat.size === entry.size && sha256(filename) === entry.sha256
    if (payloadMatches) continue
    if (options.allowPlatformSigning && isPlatformSignedCode(entry.path, platformKey)) {
      verifyPlatformSignature(filename, platformKey)
    } else {
      throw new Error(`Packaged UAR sidecar checksum mismatch for ${platformKey}: ${entry.path}`)
    }
  }

  const executable = path.join(payloadDir, platformKey.startsWith('win32-') ? 'uar-sidecar.exe' : 'uar-sidecar')
  const executableStat = fs.statSync(executable)
  if (!platformKey.startsWith('win32-') && (executableStat.mode & 0o111) === 0) {
    throw new Error(`Packaged UAR sidecar is not executable for ${platformKey}`)
  }

  return { executable, payloadDir }
}

function assertPackagedUarPayloadAbsent(resourcesDir, platformKey) {
  const payloadDir = getPackagedBinaryDirectory(resourcesDir, platformKey)
  const present = getUarPayloadInventory(platformKey).filter((filename) =>
    fs.existsSync(path.join(payloadDir, ...filename.split('/')))
  )
  if (present.length > 0) {
    throw new Error(`Disabled-UAR package contains UAR payload for ${platformKey}: ${present.join(', ')}`)
  }
}

function probePackagedUarSidecar(executable, payloadDir, platformKey) {
  const result = spawnSync(executable, [], {
    cwd: payloadDir,
    input: 'invalid-launch-token\n',
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true
  })
  if (result.error) throw new Error(`Packaged UAR sidecar could not launch for ${platformKey}: ${result.error.message}`)
  if (result.status !== 2 || !result.stderr.includes('UAR sidecar refused to start')) {
    throw new Error(
      `Packaged UAR sidecar launch probe failed for ${platformKey}: exit ${String(result.status)}, ` +
        `signal ${String(result.signal)}`
    )
  }
}

function verifyAndProbePackagedUarPayload(resourcesDir, platformKey, options) {
  const payload = verifyPackagedUarPayload(resourcesDir, platformKey, options)
  probePackagedUarSidecar(payload.executable, payload.payloadDir, platformKey)
  return payload
}

module.exports = {
  assertPackagedUarPayloadAbsent,
  getPackagedBinaryDirectory,
  getUarPayloadInventory,
  verifyAndProbePackagedUarPayload,
  verifyPackagedUarPayload
}
