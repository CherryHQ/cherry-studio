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

// ── Tool definitions ─────────────────────────────────────────────────
// Each tool declares: version, per-platform packages, and how to build
// the download URL / extract the archive.
//
// Package fields:
//   url       — full download URL
//   archive   — 'none' (bare binary) | 'zip' | 'tar.gz'
//   binaries  — list of binary filenames to extract
//   strip     — for zip: glob prefix per binary; for tar.gz: --strip-components depth
//   sha256    — checksum of the downloaded file (binary itself or archive)

const MISE_VERSION = '2026.5.11'
const BUN_VERSION = '1.3.14'
const UV_VERSION = '0.11.16'
const RG_VERSION = '14.1.1'

function miseUrl(file) {
  return `https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/${file}`
}
function bunUrl(asset) {
  return `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${asset}.zip`
}
function uvUrl(asset, ext) {
  return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}.${ext}`
}
function rgUrl(asset, ext) {
  return `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${asset}.${ext}`
}

const TOOLS = [
  {
    name: 'mise',
    version: MISE_VERSION,
    versionFile: '.mise-version',
    required: true,
    packages: {
      'darwin-arm64': {
        url: miseUrl(`mise-v${MISE_VERSION}-macos-arm64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: '1f404ecafe0a2ecc34bae661661b99e9cb06dba0f03f0e906ae4528b57d37e6c'
      },
      'darwin-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-macos-x64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: '0a2383b0ca7e3cea2e68796917506e79b74f06a1a64501c7f83e14f2520b43f0'
      },
      'linux-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-linux-x64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: '9bb41ae4dbe2bcdfdbe36cf3c737a8bdb72035c03af3b7218a70780988f62b9b'
      },
      'linux-arm64': {
        url: miseUrl(`mise-v${MISE_VERSION}-linux-arm64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: 'a588ea2fec11f6383bd24998f5ede89100f70f1f47943b9ea30c88e4048ea91f'
      },
      'win32-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-windows-x64.exe`),
        archive: 'none',
        binaries: ['mise.exe'],
        sha256: '580401ddbc9977f94db85bbea51323f5aea6953dbe2a452cb49c2adcf1d8f7c0'
      },
      'win32-arm64': {
        url: miseUrl(`mise-v${MISE_VERSION}-windows-arm64.exe`),
        archive: 'none',
        binaries: ['mise.exe'],
        sha256: 'd29b9909d2aa1c85e4a43b9b4be24b2015423628ae29b15d7e677ab00fccd47e'
      }
    }
  },
  {
    name: 'bun',
    version: BUN_VERSION,
    versionFile: '.bun-version',
    packages: {
      'darwin-arm64': {
        url: bunUrl('bun-darwin-aarch64'),
        archive: 'zip',
        binaries: ['bun'],
        strip: 'bun-darwin-aarch64',
        sha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620'
      },
      'darwin-x64': {
        url: bunUrl('bun-darwin-x64'),
        archive: 'zip',
        binaries: ['bun'],
        strip: 'bun-darwin-x64',
        sha256: '4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633'
      },
      'linux-arm64': {
        url: bunUrl('bun-linux-aarch64'),
        archive: 'zip',
        binaries: ['bun'],
        strip: 'bun-linux-aarch64',
        sha256: 'a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b'
      },
      'linux-x64': {
        url: bunUrl('bun-linux-x64'),
        archive: 'zip',
        binaries: ['bun'],
        strip: 'bun-linux-x64',
        sha256: '951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f'
      },
      'win32-x64': {
        url: bunUrl('bun-windows-x64'),
        archive: 'zip',
        binaries: ['bun.exe'],
        strip: 'bun-windows-x64',
        sha256: '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922'
      },
      'win32-arm64': {
        url: bunUrl('bun-windows-aarch64'),
        archive: 'zip',
        binaries: ['bun.exe'],
        strip: 'bun-windows-aarch64',
        sha256: '89841f5a57f2348b67ec0839b718f4bf4ea7d07c371c9ba4b77b6c790f918953'
      }
    }
  },
  {
    name: 'uv',
    version: UV_VERSION,
    versionFile: '.uv-version',
    packages: {
      'darwin-arm64': {
        url: uvUrl('uv-aarch64-apple-darwin', 'tar.gz'),
        archive: 'tar.gz',
        binaries: ['uv', 'uvx'],
        sha256: '2b25be1af546be330b340b0a76b99f989daa6d92678fdffb87438e661e9d88fb'
      },
      'darwin-x64': {
        url: uvUrl('uv-x86_64-apple-darwin', 'tar.gz'),
        archive: 'tar.gz',
        binaries: ['uv', 'uvx'],
        sha256: '6b91ae3de155f51bd1f5b74814821c79f016a176561f252cd9ddfb976939af2e'
      },
      'linux-arm64': {
        url: uvUrl('uv-aarch64-unknown-linux-gnu', 'tar.gz'),
        archive: 'tar.gz',
        binaries: ['uv', 'uvx'],
        sha256: '8c9d0f0ee98166ae6ab198747519ba6f25db29d185bd2ae5960ecebc91a5c22a'
      },
      'linux-x64': {
        url: uvUrl('uv-x86_64-unknown-linux-gnu', 'tar.gz'),
        archive: 'tar.gz',
        binaries: ['uv', 'uvx'],
        sha256: '74947fe2c03315cf07e82ab3acc703eddef01aba4d5232a98e4c6825ec116131'
      },
      'win32-x64': {
        url: uvUrl('uv-x86_64-pc-windows-msvc', 'zip'),
        archive: 'zip',
        binaries: ['uv.exe', 'uvx.exe'],
        sha256: 'dd9d6d6554bfab265bfa98aa8e8a406c5c3a7b97582f93de1f4d48d9154a0395'
      },
      'win32-arm64': {
        url: uvUrl('uv-aarch64-pc-windows-msvc', 'zip'),
        archive: 'zip',
        binaries: ['uv.exe', 'uvx.exe'],
        sha256: 'e4f8e70eb21f0f4efd2eeb159ab289f9a16057d59881a4475758be4ce39bc8c5'
      }
    }
  },
  {
    name: 'rg',
    version: RG_VERSION,
    versionFile: '.rg-version',
    packages: {
      'darwin-arm64': {
        url: rgUrl('aarch64-apple-darwin', 'tar.gz'),
        archive: 'tar.gz',
        binaries: ['rg'],
        sha256: '24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be'
      },
      'darwin-x64': {
        url: rgUrl('x86_64-apple-darwin', 'tar.gz'),
        archive: 'tar.gz',
        binaries: ['rg'],
        sha256: 'fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3'
      },
      'linux-arm64': {
        url: rgUrl('aarch64-unknown-linux-gnu', 'tar.gz'),
        archive: 'tar.gz',
        binaries: ['rg'],
        sha256: 'c827481c4ff4ea10c9dc7a4022c8de5db34a5737cb74484d62eb94a95841ab2f'
      },
      'linux-x64': {
        url: rgUrl('x86_64-unknown-linux-musl', 'tar.gz'),
        archive: 'tar.gz',
        binaries: ['rg'],
        sha256: '4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e'
      },
      'win32-x64': {
        url: rgUrl('x86_64-pc-windows-msvc', 'zip'),
        archive: 'zip',
        binaries: ['rg.exe'],
        strip: `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc`,
        sha256: 'd0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1'
      },
      'win32-arm64': {
        url: rgUrl('x86_64-pc-windows-msvc', 'zip'),
        archive: 'zip',
        binaries: ['rg.exe'],
        strip: `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc`,
        sha256: 'd0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1'
      }
    }
  }
]

// ── Core logic ───────────────────────────────────────────────────────

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

function isUpToDate(binaryPaths, versionPath, expectedVersion) {
  if (!fs.existsSync(versionPath)) return false
  if (binaryPaths.some((binaryPath) => !fs.existsSync(binaryPath))) return false
  return fs.readFileSync(versionPath, 'utf8').trim() === expectedVersion
}

function download(url, dest) {
  console.log(`  Downloading: ${url}`)
  execFileSync('curl', ['-fSL', '--retry', '3', '-o', dest, url], { stdio: 'inherit' })
}

function extract(archivePath, archive, outputDir, pkg) {
  if (archive === 'zip') {
    if (process.platform === 'win32') {
      const tmpExtract = path.join(outputDir, '__extract_tmp')
      fs.mkdirSync(tmpExtract, { recursive: true })
      try {
        execFileSync(
          'powershell',
          ['-NoProfile', '-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpExtract}' -Force`],
          { stdio: 'inherit' }
        )
        for (const b of pkg.binaries) {
          const src = pkg.strip ? path.join(tmpExtract, pkg.strip, b) : path.join(tmpExtract, b)
          fs.copyFileSync(src, path.join(outputDir, b))
        }
      } finally {
        fs.rmSync(tmpExtract, { recursive: true, force: true })
      }
    } else {
      const globs = pkg.binaries.map((b) => (pkg.strip ? `${pkg.strip}/${b}` : b))
      execFileSync('unzip', ['-o', '-j', archivePath, ...globs, '-d', outputDir], { stdio: 'inherit' })
    }
  } else if (archive === 'tar.gz') {
    // Extract to a tmp dir and copy only the listed binaries — tarballs often
    // ship LICENSE/README/man/completions that would otherwise bloat the bundle
    // and collide across tools when two of them share `outputDir`.
    const tmpExtract = path.join(outputDir, '__extract_tmp')
    fs.mkdirSync(tmpExtract, { recursive: true })
    try {
      execFileSync('tar', ['xzf', archivePath, '-C', tmpExtract, '--strip-components=1'], { stdio: 'inherit' })
      for (const b of pkg.binaries) {
        fs.copyFileSync(path.join(tmpExtract, b), path.join(outputDir, b))
      }
    } finally {
      fs.rmSync(tmpExtract, { recursive: true, force: true })
    }
  }
}

function downloadTool(tool, platformKey, outputDir) {
  const pkg = tool.packages[platformKey]
  if (!pkg) {
    if (tool.required) {
      throw new Error(`[${tool.name}] No binary for "${platformKey}". Add an entry to packages.`)
    }
    console.log(`[${tool.name}] No binary for "${platformKey}", skipping`)
    return
  }

  const binaryPaths = pkg.binaries.map((binary) => path.join(outputDir, binary))
  const primaryDest = binaryPaths[0]
  const versionPath = path.join(outputDir, tool.versionFile)

  if (isUpToDate(binaryPaths, versionPath, tool.version)) {
    for (const binaryPath of binaryPaths) chmodExec(binaryPath)
    console.log(`[${tool.name}] ${tool.version} already installed`)
    return
  }

  if (pkg.archive === 'none') {
    download(pkg.url, primaryDest)
    verifyHash(primaryDest, pkg.sha256)
  } else {
    const ext = pkg.archive === 'tar.gz' ? 'tar.gz' : 'zip'
    const archivePath = path.join(outputDir, `${tool.name}.${ext}`)
    download(pkg.url, archivePath)
    verifyHash(archivePath, pkg.sha256)
    extract(archivePath, pkg.archive, outputDir, pkg)
    fs.unlinkSync(archivePath)
  }

  for (const b of pkg.binaries) chmodExec(path.join(outputDir, b))
  fs.writeFileSync(versionPath, tool.version, 'utf8')
  console.log(`[${tool.name}] Installed ${pkg.binaries.join(', ')} ${tool.version}`)
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const platform = process.argv[2] || process.platform
  const arch = process.argv[3] || process.arch
  const platformKey = `${platform}-${arch}`

  console.log(`Downloading binaries for ${platformKey}...`)

  const outputDir = path.join(__dirname, '..', 'resources', 'binaries', platformKey)
  fs.mkdirSync(outputDir, { recursive: true })

  for (const tool of TOOLS) {
    try {
      downloadTool(tool, platformKey, outputDir)
    } catch (error) {
      if (tool.required) {
        throw error
      }
      console.warn(`[${tool.name}] Download failed (non-fatal): ${error.message}`)
    }
  }

  console.log(`All binaries downloaded to ${outputDir}`)
}

/**
 * Assert every bundled binary exists for the target platform. Dev keeps the
 * lenient main() (non-required tools downgrade to a warning), but a release must
 * never ship a half-empty resources/binaries/<platform> — a transient GitHub
 * outage during download would otherwise produce a working build with no rg
 * (search breaks) and no error. Call this from before-pack.js after main().
 */
function verifyBundledBinaries(platform, arch) {
  const platformKey = `${platform}-${arch}`
  const outputDir = path.join(__dirname, '..', 'resources', 'binaries', platformKey)
  const missing = []

  for (const tool of TOOLS) {
    const pkg = tool.packages[platformKey]
    if (!pkg) {
      missing.push(`${tool.name} (no package for ${platformKey})`)
      continue
    }
    for (const binary of pkg.binaries) {
      if (!fs.existsSync(path.join(outputDir, binary))) {
        missing.push(path.join(platformKey, binary))
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Bundled binaries missing after download for ${platformKey}:\n  ${missing.join('\n  ')}`)
  }
  console.log(`Verified all bundled binaries exist for ${platformKey}`)
}

module.exports = { verifyBundledBinaries }

// Only auto-download when run directly (node scripts/download-binaries.js ...).
// before-pack.js requires this module for verifyBundledBinaries without
// triggering a download for the build host's platform.
if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error('Failed to download binaries:', error.message)
    process.exit(1)
  }
}
