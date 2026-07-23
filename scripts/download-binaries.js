/**
 * Downloads bundled binaries (mise, bun, uv, ripgrep, and Windows MinGit) for the
 * target platform during build.
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
//   archive   — 'none' (bare binary) | 'zip' | 'zip-tree' | 'tar.gz'
//   binaries  — list of binary filenames to verify/chmod, relative to outputDir
//                (for 'zip-tree' these live under `dir`, e.g. 'git/cmd/git.exe')
//   dir       — for 'zip-tree': subdir under outputDir to extract the full tree into
//   strip     — for zip: glob prefix per binary; for tar.gz: --strip-components depth
//   sha256    — checksum of the downloaded file (binary itself or archive)
//
// Tool fields:
//   isWindowsOnly — tool has packages only for win32; non-Windows builds skip it
//                 (MinGit — other platforms fall back to the user's system git)

const MISE_VERSION = '2026.7.3'
const BUN_VERSION = '1.3.14'
const UV_VERSION = '0.11.16'
const RG_VERSION = '14.1.1'
const MINGIT_VERSION = '2.54.0'

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
function mingitUrl(asset) {
  return `https://github.com/git-for-windows/git/releases/download/v${MINGIT_VERSION}.windows.1/${asset}`
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
        sha256: '865f7c617787749bfd16a3b50a5385df9c552640a4177bafdc35ae19c4215731'
      },
      'darwin-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-macos-x64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: '69cce686f0bed5b5ee8135b29ca81b4735bd52dbd18517a1024843cfdf770ab0'
      },
      'linux-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-linux-x64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: '06088e84e4514b59fd2b6b17927bcc37aa0ab10020a270868871fb010b92069b'
      },
      'linux-arm64': {
        url: miseUrl(`mise-v${MISE_VERSION}-linux-arm64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: '7a39a84a040449e1932a24b3b710746fc4a2b6d7080cc8376a2731d00488bf0d'
      },
      'win32-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-windows-x64.exe`),
        archive: 'none',
        binaries: ['mise.exe'],
        sha256: '4c950c99fc903f46afc8c6e8c2137b65f9a8ab638041549afb9a62fa5de286ea'
      },
      'win32-arm64': {
        url: miseUrl(`mise-v${MISE_VERSION}-windows-arm64.exe`),
        archive: 'none',
        binaries: ['mise.exe'],
        sha256: '997644d959b5d2fe20247ce2ed956f50e9aa5bd7571ad9b08f1d501b58354fde'
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
  },
  {
    // Git for Windows MinGit — non-interactive, multi-file Git distribution.
    // Bundled as a fallback when the user has no system git (see
    // src/main/utils/bundledGit.ts). Windows-only: macOS/Linux use the system git. Unlike
    // the single-binary tools above it ships its whole tree under <key>/git/,
    // so it is run in place from resources rather than copied into cherry.bin.
    name: 'mingit',
    version: MINGIT_VERSION,
    versionFile: '.mingit-version',
    isWindowsOnly: true,
    packages: {
      'win32-x64': {
        url: mingitUrl(`MinGit-${MINGIT_VERSION}-64-bit.zip`),
        archive: 'zip-tree',
        dir: 'git',
        binaries: ['git/cmd/git.exe'],
        sha256: '04f937e1f0918b17b9be6f2294cb2bb66e96e1d9832d1c298e2de088a1d0e668'
      },
      'win32-arm64': {
        url: mingitUrl(`MinGit-${MINGIT_VERSION}-arm64.zip`),
        archive: 'zip-tree',
        dir: 'git',
        binaries: ['git/cmd/git.exe'],
        sha256: '68f6bdda5b58f4e40f431c0da48b05ba5596445314d5e491e7b4aebb1ec2e985'
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
  } else if (archive === 'zip-tree') {
    // Full-tree extraction (MinGit): preserve the whole directory layout under
    // pkg.dir instead of copying out individual binaries. Wipe first so a stale
    // tree from an older version can't leave orphaned files behind.
    const destDir = path.join(outputDir, pkg.dir)
    fs.rmSync(destDir, { recursive: true, force: true })
    fs.mkdirSync(destDir, { recursive: true })
    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`],
        { stdio: 'inherit' }
      )
    } else {
      execFileSync('unzip', ['-o', '-q', archivePath, '-d', destDir], { stdio: 'inherit' })
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
function verifyBundledBinaries(platform, arch, options = {}) {
  // `tools` / `resourcesDir` injectable for tests; production callers pass none.
  const { tools = TOOLS, resourcesDir = path.join(__dirname, '..', 'resources', 'binaries') } = options
  const platformKey = `${platform}-${arch}`
  const outputDir = path.join(resourcesDir, platformKey)
  const missing = []

  for (const tool of tools) {
    const pkg = tool.packages[platformKey]
    if (!pkg) {
      // isWindowsOnly tools (MinGit) legitimately have no package on macOS/Linux.
      if (!tool.isWindowsOnly) missing.push(`${tool.name} (no package for ${platformKey})`)
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

module.exports = { extract, verifyBundledBinaries }

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
