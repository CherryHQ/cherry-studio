/**
 * Downloads bundled binaries (mise, bun, uv, ripgrep, and Windows MinGit) for the
 * target platform during build.
 * Called from before-pack.js (and the dev script) to bundle binaries into resources/binaries/.
 *
 * Usage:
 *   node scripts/download-binaries.js [platform] [arch] [--packaging]
 *   e.g. node scripts/download-binaries.js darwin arm64
 *
 * Without --packaging (dev), downloads go to a cache shared by every git worktree
 * of this repository and are hard-linked into resources/binaries/, so a second
 * worktree costs links instead of a fresh download. before-pack.js passes
 * --packaging to route new downloads straight into resources/. Note that the
 * flag only decides where a download goes: links a previous dev run left in
 * resources/ are up to date and stay, which is harmless because packaging only
 * ever reads and copies them.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO_ROOT = path.join(__dirname, '..')
const BINARIES_ROOT = path.join(REPO_ROOT, 'resources', 'binaries')

// Staging lives under a per-checkout id, not a pid: the same worktree must find
// its own partial download again to resume it, while two worktrees running
// against the shared cache at once must never write the same path.
const STAGING_PREFIX = '.staging-'
// A tree being replaced is parked under this prefix for the moment between the
// two renames. A crash there leaves one behind, so it shares the staging rule:
// cache-internal, never mirrored, swept when a run finishes.
const RETIRED_PREFIX = '.retired-'
const STAGING_DIR = STAGING_PREFIX + crypto.createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 8)

/**
 * Cache root shared by all worktrees: `<git-common-dir>/cherry-binaries`.
 * The common dir is the one .git that every worktree points back to — a
 * worktree's own gitdir is private to it and would defeat the sharing.
 * Returns null outside a git checkout (e.g. a source tarball), where the
 * caller falls back to downloading into resources/ directly.
 */
function resolveSharedCacheRoot() {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (!commonDir) return null
    return path.join(path.resolve(REPO_ROOT, commonDir), 'cherry-binaries')
  } catch {
    return null
  }
}

/**
 * Mirror `srcDir` into `destDir` as hard links, so both paths share one inode
 * and the copy costs no extra disk. Falls back to a real copy when linking is
 * unavailable (different volume, filesystem without hard links). Anything in
 * `destDir` with no counterpart in the cache is removed: a shrinking release
 * (MinGit dropping a file) would otherwise leave it behind forever, which is
 * the very thing `extract`'s zip-tree branch wipes the destination to avoid.
 */
function materialize(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const mirrored = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith(STAGING_PREFIX) && !entry.name.startsWith(RETIRED_PREFIX))
  const wanted = new Set(mirrored.map((entry) => entry.name))
  for (const stale of fs.readdirSync(destDir)) {
    if (!wanted.has(stale)) fs.rmSync(path.join(destDir, stale), { recursive: true, force: true })
  }
  for (const entry of mirrored) {
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      materialize(src, dest)
      continue
    }
    const srcStat = fs.statSync(src)
    const destStat = fs.statSync(dest, { throwIfNoEntry: false })
    // ino is 0 on filesystems that do not report one; never treat that as a match.
    if (destStat && srcStat.ino !== 0 && destStat.ino === srcStat.ino) continue
    if (destStat) fs.rmSync(dest)
    try {
      fs.linkSync(src, dest)
    } catch {
      fs.copyFileSync(src, dest)
    }
  }
}

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

const MISE_VERSION = '2026.7.14'
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
        sha256: '082262daa1cd73e22f71272c574afda560c4fcf39852bc18884eae9e13cd5f2c'
      },
      'darwin-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-macos-x64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: '3a3cf40fd034f83bd5cdffd4d673d40b04a79d06affbd30e5fcc4f00ae0ac460'
      },
      'linux-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-linux-x64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: 'fc96308f4fa085d7359892ac6351ededb35ecfabf1ddc34f5757bc755a2af8a6'
      },
      'linux-arm64': {
        url: miseUrl(`mise-v${MISE_VERSION}-linux-arm64`),
        archive: 'none',
        binaries: ['mise'],
        sha256: '94a01dd78c22819aa38f9ef6c0780f48d5160b7f1f557407d6d486667296be6d'
      },
      'win32-x64': {
        url: miseUrl(`mise-v${MISE_VERSION}-windows-x64.zip`),
        archive: 'zip',
        binaries: ['mise.exe', 'mise-shim.exe'],
        strip: 'mise/bin',
        sha256: 'fdf01891877650bd0f30ff99e493d88f72423b280867ca44062ee2cecd75c78c'
      },
      'win32-arm64': {
        url: miseUrl(`mise-v${MISE_VERSION}-windows-arm64.zip`),
        archive: 'zip',
        binaries: ['mise.exe', 'mise-shim.exe'],
        strip: 'mise/bin',
        sha256: '10627ebedc1e0a53fe669b9e93b1701975f0cba1165759bc270796a0de37b691'
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
  try {
    // -C - resumes a partial file, so an interrupted transfer over a slow link
    // does not restart from zero. `dest` is always version-scoped, so a resume
    // can only ever continue the same asset.
    execFileSync('curl', ['-fSL', '-C', '-', '--retry', '3', '-o', dest, url], { stdio: 'inherit' })
  } catch (error) {
    // 33 is curl's range error — the server refused the resume, which a plain
    // download fixes. Every other failure (a dropped connection above all) must
    // propagate with the partial file intact, or resuming would be useless in
    // exactly the case it exists for. Corrupt resumed bytes are caught by
    // verifyHash, which deletes the file so the next run starts clean.
    if (error.status !== 33) throw error
    fs.rmSync(dest, { force: true })
    execFileSync('curl', ['-fSL', '--retry', '3', '-o', dest, url], { stdio: 'inherit' })
  }
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
  const versionPath = path.join(outputDir, tool.versionFile)

  if (isUpToDate(binaryPaths, versionPath, tool.version)) {
    for (const binaryPath of binaryPaths) chmodExec(binaryPath)
    console.log(`[${tool.name}] ${tool.version} already installed`)
    return
  }

  // Everything lands in staging first. Several worktrees may run this against
  // one shared cache: writing the final paths directly would let two downloads
  // interleave on the same file, or one run delete an archive another is still
  // reading. Filenames stay version-scoped so a resume can only ever continue
  // the same asset, never splice a new version onto the previous one.
  const staging = path.join(outputDir, STAGING_DIR, tool.name)
  fs.mkdirSync(staging, { recursive: true })

  if (pkg.archive === 'none') {
    const staged = path.join(staging, `${pkg.binaries[0]}.${tool.version}.part`)
    download(pkg.url, staged)
    verifyHash(staged, pkg.sha256)
    fs.renameSync(staged, path.join(staging, pkg.binaries[0]))
  } else {
    const ext = pkg.archive === 'tar.gz' ? 'tar.gz' : 'zip'
    const archivePath = path.join(staging, `${tool.name}-${tool.version}.${ext}`)
    download(pkg.url, archivePath)
    verifyHash(archivePath, pkg.sha256)
    extract(archivePath, pkg.archive, staging, pkg)
    fs.unlinkSync(archivePath)
  }

  commitStaged(staging, outputDir, pkg)
  for (const b of pkg.binaries) chmodExec(path.join(outputDir, b))

  // The marker publishes through staging too. Writing it in place would keep
  // its inode, so the new version would follow every worktree's hard link while
  // the binaries — replaced by rename, hence new inodes — stayed old there.
  // isUpToDate and BinaryManager both trust the marker, so those worktrees would
  // serve stale binaries under the new version number.
  //
  // Publishing it last is what makes a concurrent observer safe: seeing the new
  // marker implies every binary is already in place, and seeing the old one
  // means isUpToDate re-downloads rather than trusting a partial commit.
  const stagedMarker = path.join(staging, tool.versionFile)
  fs.writeFileSync(stagedMarker, tool.version, 'utf8')
  fs.renameSync(stagedMarker, versionPath)

  // Only on success: an interrupted run keeps its partial file to resume from.
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    fs.rmdirSync(path.dirname(staging))
  } catch {
    // another tool of this run still has an unfinished download parked there
  }
  console.log(`[${tool.name}] Installed ${pkg.binaries.join(', ')} ${tool.version}`)
}

/**
 * Move a verified staging result into place with rename, so nothing ever reads a
 * half-written file. The atomicity is per file, not per tool: a multi-file tool
 * (uv/uvx, mise.exe/mise-shim.exe) commits as a sequence of renames, and the
 * zip-tree path has a moment between retiring the old tree and moving the new
 * one in. A concurrent run can observe those intermediate states. Both runs
 * publish byte-identical verified content, so the outcome converges either way —
 * but this is not a transaction, and making it one would need a per-tool lock.
 * `zip-tree` also retires the previous tree rather than merging into it, so a
 * shrinking release cannot leave orphans behind.
 */
function commitStaged(staging, outputDir, pkg) {
  if (pkg.dir) {
    const finalDir = path.join(outputDir, pkg.dir)
    const retired = path.join(outputDir, `${RETIRED_PREFIX}${process.pid}-${pkg.dir}`)
    if (fs.existsSync(finalDir)) fs.renameSync(finalDir, retired)
    try {
      fs.renameSync(path.join(staging, pkg.dir), finalDir)
    } catch (error) {
      // ENOTEMPTY means a concurrent run published first. Both trees passed the
      // same checksum, so its result is ours — keep it rather than failing.
      if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error
    }
    fs.rmSync(retired, { recursive: true, force: true })
    return
  }
  for (const binary of pkg.binaries) {
    fs.renameSync(path.join(staging, binary), path.join(outputDir, binary))
  }
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2)
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const packaging = argv.includes('--packaging')
  const platform = positional[0] || process.platform
  const arch = positional[1] || process.arch
  const platformKey = `${platform}-${arch}`

  console.log(`Downloading binaries for ${platformKey}...`)

  const bundleDir = path.join(BINARIES_ROOT, platformKey)
  const cacheRoot = packaging ? null : resolveSharedCacheRoot()
  const outputDir = cacheRoot ? path.join(cacheRoot, platformKey) : bundleDir
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

  // Retired trees only exist between two renames, so any found here is debris
  // from a run that died mid-commit.
  for (const entry of fs.readdirSync(outputDir)) {
    if (entry.startsWith(RETIRED_PREFIX)) fs.rmSync(path.join(outputDir, entry), { recursive: true, force: true })
  }

  if (cacheRoot) {
    materialize(outputDir, bundleDir)
    console.log(`All binaries hard-linked from ${outputDir} into ${bundleDir}`)
  } else {
    console.log(`All binaries downloaded to ${outputDir}`)
  }
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
  const { tools = TOOLS, resourcesDir = BINARIES_ROOT } = options
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

module.exports = { download, downloadTool, extract, materialize, verifyBundledBinaries, TOOLS }

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
