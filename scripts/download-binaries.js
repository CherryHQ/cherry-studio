/**
 * Downloads mise, bun, and uv binaries for the target platform during build.
 * Called from before-pack.js (and the dev script) to bundle binaries into resources/binaries/.
 *
 * Usage:
 *   node scripts/download-binaries.js [platform] [arch]
 *   e.g. node scripts/download-binaries.js darwin arm64
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

// ── Versions ──────────────────────────────────────────────────────────
const MISE_VERSION = '2026.5.11'
const BUN_VERSION = '1.3.14'
const UV_VERSION = '0.11.16'

// ── Mise: bare binary download (no archive) ───────────────────────────
const MISE_PACKAGES = {
  'darwin-arm64': {
    file: `mise-v${MISE_VERSION}-macos-arm64`,
    binary: 'mise',
    sha256: '1f404ecafe0a2ecc34bae661661b99e9cb06dba0f03f0e906ae4528b57d37e6c'
  },
  'darwin-x64': {
    file: `mise-v${MISE_VERSION}-macos-x64`,
    binary: 'mise',
    sha256: '0a2383b0ca7e3cea2e68796917506e79b74f06a1a64501c7f83e14f2520b43f0'
  },
  'linux-x64': {
    file: `mise-v${MISE_VERSION}-linux-x64`,
    binary: 'mise',
    sha256: '9bb41ae4dbe2bcdfdbe36cf3c737a8bdb72035c03af3b7218a70780988f62b9b'
  },
  'linux-arm64': {
    file: `mise-v${MISE_VERSION}-linux-arm64`,
    binary: 'mise',
    sha256: 'a588ea2fec11f6383bd24998f5ede89100f70f1f47943b9ea30c88e4048ea91f'
  },
  'win32-x64': {
    file: `mise-v${MISE_VERSION}-windows-x64.exe`,
    binary: 'mise.exe',
    sha256: '580401ddbc9977f94db85bbea51323f5aea6953dbe2a452cb49c2adcf1d8f7c0'
  },
  'win32-arm64': {
    file: `mise-v${MISE_VERSION}-windows-arm64.exe`,
    binary: 'mise.exe',
    sha256: 'd29b9909d2aa1c85e4a43b9b4be24b2015423628ae29b15d7e677ab00fccd47e'
  }
}

// ── Bun: zip containing <asset>/bun[.exe] ─────────────────────────────
const BUN_PACKAGES = {
  'darwin-arm64': {
    asset: 'bun-darwin-aarch64',
    binary: 'bun',
    sha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620'
  },
  'darwin-x64': {
    asset: 'bun-darwin-x64',
    binary: 'bun',
    sha256: '4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633'
  },
  'linux-arm64': {
    asset: 'bun-linux-aarch64',
    binary: 'bun',
    sha256: 'a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b'
  },
  'linux-x64': {
    asset: 'bun-linux-x64',
    binary: 'bun',
    sha256: '951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f'
  },
  'win32-x64': {
    asset: 'bun-windows-x64',
    binary: 'bun.exe',
    sha256: '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922'
  }
  // No bun release for win32-arm64
}

// ── uv: tar.gz (zip on Windows) containing <asset>/uv[.exe] + uvx[.exe] ──
const UV_PACKAGES = {
  'darwin-arm64': {
    asset: 'uv-aarch64-apple-darwin',
    ext: 'tar.gz',
    binaries: ['uv', 'uvx'],
    sha256: '2b25be1af546be330b340b0a76b99f989daa6d92678fdffb87438e661e9d88fb'
  },
  'darwin-x64': {
    asset: 'uv-x86_64-apple-darwin',
    ext: 'tar.gz',
    binaries: ['uv', 'uvx'],
    sha256: '6b91ae3de155f51bd1f5b74814821c79f016a176561f252cd9ddfb976939af2e'
  },
  'linux-arm64': {
    asset: 'uv-aarch64-unknown-linux-gnu',
    ext: 'tar.gz',
    binaries: ['uv', 'uvx'],
    sha256: '8c9d0f0ee98166ae6ab198747519ba6f25db29d185bd2ae5960ecebc91a5c22a'
  },
  'linux-x64': {
    asset: 'uv-x86_64-unknown-linux-gnu',
    ext: 'tar.gz',
    binaries: ['uv', 'uvx'],
    sha256: '74947fe2c03315cf07e82ab3acc703eddef01aba4d5232a98e4c6825ec116131'
  },
  'win32-x64': {
    asset: 'uv-x86_64-pc-windows-msvc',
    ext: 'zip',
    binaries: ['uv.exe', 'uvx.exe'],
    sha256: 'dd9d6d6554bfab265bfa98aa8e8a406c5c3a7b97582f93de1f4d48d9154a0395'
  },
  'win32-arm64': {
    asset: 'uv-aarch64-pc-windows-msvc',
    ext: 'zip',
    binaries: ['uv.exe', 'uvx.exe'],
    sha256: 'e4f8e70eb21f0f4efd2eeb159ab289f9a16057d59881a4475758be4ce39bc8c5'
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function verifyHash(filePath, expected) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  if (hash !== expected) {
    fs.unlinkSync(filePath)
    throw new Error(`SHA256 mismatch: expected ${expected}, got ${hash}`)
  }
}

function chmodExec(filePath) {
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o755)
}

function isUpToDate(destPath, versionPath, expectedVersion, expectedSha256) {
  if (!fs.existsSync(destPath) || !fs.existsSync(versionPath)) return false
  const installed = fs.readFileSync(versionPath, 'utf8').trim()
  if (installed !== expectedVersion) return false
  if (expectedSha256) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(destPath)).digest('hex')
    if (hash !== expectedSha256) return false
  }
  return true
}

// ── Download functions ────────────────────────────────────────────────

function downloadMise(platformKey, outputDir) {
  const pkg = MISE_PACKAGES[platformKey]
  if (!pkg) {
    throw new Error(`[mise] No binary for "${platformKey}". Add an entry to MISE_PACKAGES.`)
  }

  const destPath = path.join(outputDir, pkg.binary)
  const versionPath = path.join(outputDir, '.mise-version')

  if (isUpToDate(destPath, versionPath, MISE_VERSION, pkg.sha256)) {
    chmodExec(destPath)
    console.log(`[mise] ${pkg.binary} ${MISE_VERSION} already installed`)
    return
  }

  const url = `https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/${pkg.file}`
  console.log(`[mise] Downloading: ${url}`)
  execFileSync('curl', ['-fSL', '--retry', '3', '-o', destPath, url], { stdio: 'inherit' })
  verifyHash(destPath, pkg.sha256)
  chmodExec(destPath)
  fs.writeFileSync(versionPath, MISE_VERSION, 'utf8')
  console.log(`[mise] Installed ${pkg.binary} ${MISE_VERSION}`)
}

function downloadBun(platformKey, outputDir) {
  const pkg = BUN_PACKAGES[platformKey]
  if (!pkg) {
    console.log(`[bun] No binary for "${platformKey}", skipping`)
    return
  }

  const destPath = path.join(outputDir, pkg.binary)
  const versionPath = path.join(outputDir, '.bun-version')

  if (isUpToDate(destPath, versionPath, BUN_VERSION)) {
    chmodExec(destPath)
    console.log(`[bun] ${pkg.binary} ${BUN_VERSION} already installed`)
    return
  }

  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${pkg.asset}.zip`
  const archivePath = path.join(outputDir, `${pkg.asset}.zip`)

  console.log(`[bun] Downloading: ${url}`)
  execFileSync('curl', ['-fSL', '--retry', '3', '-o', archivePath, url], { stdio: 'inherit' })
  verifyHash(archivePath, pkg.sha256)
  execFileSync('unzip', ['-o', '-j', archivePath, `${pkg.asset}/${pkg.binary}`, '-d', outputDir], { stdio: 'inherit' })
  fs.unlinkSync(archivePath)
  chmodExec(destPath)
  fs.writeFileSync(versionPath, BUN_VERSION, 'utf8')
  console.log(`[bun] Installed ${pkg.binary} ${BUN_VERSION}`)
}

function downloadUv(platformKey, outputDir) {
  const pkg = UV_PACKAGES[platformKey]
  if (!pkg) {
    console.log(`[uv] No binary for "${platformKey}", skipping`)
    return
  }

  const firstDest = path.join(outputDir, pkg.binaries[0])
  const versionPath = path.join(outputDir, '.uv-version')

  if (isUpToDate(firstDest, versionPath, UV_VERSION)) {
    for (const b of pkg.binaries) chmodExec(path.join(outputDir, b))
    console.log(`[uv] ${pkg.binaries[0]} ${UV_VERSION} already installed`)
    return
  }

  const archiveName = `${pkg.asset}.${pkg.ext}`
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archiveName}`
  const archivePath = path.join(outputDir, archiveName)

  console.log(`[uv] Downloading: ${url}`)
  execFileSync('curl', ['-fSL', '--retry', '3', '-o', archivePath, url], { stdio: 'inherit' })
  verifyHash(archivePath, pkg.sha256)

  if (pkg.ext === 'tar.gz') {
    execFileSync('tar', ['xzf', archivePath, '-C', outputDir, '--strip-components=1'], { stdio: 'inherit' })
  } else {
    execFileSync('unzip', ['-o', '-j', archivePath, `${pkg.asset}/*`, '-d', outputDir], { stdio: 'inherit' })
  }
  fs.unlinkSync(archivePath)

  for (const b of pkg.binaries) chmodExec(path.join(outputDir, b))
  fs.writeFileSync(versionPath, UV_VERSION, 'utf8')
  console.log(`[uv] Installed ${pkg.binaries.join(', ')} ${UV_VERSION}`)
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const platform = process.argv[2] || process.platform
  const arch = process.argv[3] || process.arch
  const platformKey = `${platform}-${arch}`

  console.log(`Downloading binaries for ${platformKey}...`)

  const outputDir = path.join(__dirname, '..', 'resources', 'binaries', platformKey)
  fs.mkdirSync(outputDir, { recursive: true })

  downloadMise(platformKey, outputDir)
  downloadBun(platformKey, outputDir)
  downloadUv(platformKey, outputDir)

  console.log(`All binaries downloaded to ${outputDir}`)
}

try {
  main()
} catch (error) {
  console.error('Failed to download binaries:', error.message)
  process.exit(1)
}
