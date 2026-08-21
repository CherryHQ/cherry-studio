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
const { Transform, Writable } = require('stream')
const { pipeline } = require('stream/promises')
const { constants, createZstdCompress } = require('zlib')
const { execFileSync } = require('child_process')
const tar = require('tar')

const MANIFEST_SCHEMA_VERSION = 2
const MANIFEST_FILE = 'manifest.json'
const ZSTD_LEVEL = 10

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
    // the single-binary tools above, its whole tree is archived and installed into a
    // versioned Toolchain cache before use.
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

function hashingTransform(hash, onChunk) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      onChunk?.(chunk.length)
      callback(null, chunk)
    }
  })
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  await pipeline(
    fs.createReadStream(filePath),
    new Writable({
      write(chunk, _encoding, callback) {
        hash.update(chunk)
        callback()
      }
    })
  )
  return hash.digest('hex')
}

function createZstdStream() {
  return createZstdCompress({
    params: {
      [constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL,
      [constants.ZSTD_c_checksumFlag]: 1,
      [constants.ZSTD_c_contentSizeFlag]: 1
    }
  })
}

function writeRawArchive(sourcePath, archivePath) {
  const rawHash = crypto.createHash('sha256')
  const archiveHash = crypto.createHash('sha256')
  const stat = fs.statSync(sourcePath)

  if (path.resolve(sourcePath) === path.resolve(archivePath)) {
    return sha256File(sourcePath).then((hash) => ({ archiveSha256: hash, sha256: hash, size: stat.size }))
  }

  const tmpPath = `${archivePath}.tmp-${process.pid}`
  try {
    const source = fs.createReadStream(sourcePath)
    const destination = fs.createWriteStream(tmpPath)
    return pipeline(source, hashingTransform(rawHash), hashingTransform(archiveHash), destination)
      .then(() => {
        fs.rmSync(archivePath, { force: true })
        fs.renameSync(tmpPath, archivePath)
        return {
          archiveSha256: archiveHash.digest('hex'),
          sha256: rawHash.digest('hex'),
          size: stat.size
        }
      })
      .finally(() => fs.rmSync(tmpPath, { force: true }))
  } catch (error) {
    fs.rmSync(tmpPath, { force: true })
    throw error
  }
}

async function writeZstdArchive(source, archivePath) {
  const tmpPath = `${archivePath}.tmp-${process.pid}`
  const rawHash = crypto.createHash('sha256')
  const archiveHash = crypto.createHash('sha256')
  let rawSize = 0
  try {
    await pipeline(
      source,
      hashingTransform(rawHash, (size) => {
        rawSize += size
      }),
      createZstdStream(),
      hashingTransform(archiveHash),
      fs.createWriteStream(tmpPath)
    )
    fs.rmSync(archivePath, { force: true })
    fs.renameSync(tmpPath, archivePath)
    return {
      archiveSha256: archiveHash.digest('hex'),
      sha256: rawHash.digest('hex'),
      size: rawSize
    }
  } finally {
    fs.rmSync(tmpPath, { force: true })
  }
}

async function bundleFilesArtifact({ version, files, outputDir }) {
  const bundledFiles = []
  for (const file of files) {
    const compression = file.compression || 'zstd'
    const archive = file.archive || (compression === 'none' ? file.output : `${path.basename(file.output)}.zst`)
    const archivePath = path.join(outputDir, archive)
    const metadata =
      compression === 'none'
        ? await writeRawArchive(file.source, archivePath)
        : await writeZstdArchive(fs.createReadStream(file.source), archivePath)
    bundledFiles.push({
      output: file.output,
      archive,
      compression,
      ...metadata,
      mode: file.mode ?? 0o755
    })
  }
  return { kind: 'files', version, files: bundledFiles }
}

function listTarEntries(rootDir, stripRoot = false) {
  const parent = stripRoot ? rootDir : path.dirname(rootDir)
  const entries = []

  function visit(absolutePath) {
    const relativePath = path.relative(parent, absolutePath).split(path.sep).join('/')
    entries.push(relativePath)
    if (!fs.statSync(absolutePath).isDirectory()) return
    for (const entry of fs.readdirSync(absolutePath).sort()) {
      visit(path.join(absolutePath, entry))
    }
  }

  if (stripRoot) {
    for (const entry of fs.readdirSync(rootDir).sort()) visit(path.join(rootDir, entry))
  } else {
    visit(rootDir)
  }
  return entries
}

async function listTreeFiles(rootDir, stripRoot = false) {
  const parent = stripRoot ? rootDir : path.dirname(rootDir)
  const files = []

  async function visit(absolutePath) {
    const stat = fs.lstatSync(absolutePath)
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolutePath).sort()) {
        await visit(path.join(absolutePath, entry))
      }
      return
    }
    if (!stat.isFile()) throw new Error(`Unsupported bundled tree entry: ${absolutePath}`)
    files.push({
      path: path.relative(parent, absolutePath).split(path.sep).join('/'),
      sha256: await sha256File(absolutePath),
      size: stat.size,
      mode: stat.mode & 0o777
    })
  }

  if (stripRoot) {
    for (const entry of fs.readdirSync(rootDir).sort()) await visit(path.join(rootDir, entry))
  } else {
    await visit(rootDir)
  }
  return files
}

async function bundleTreeArtifact({ version, rootDir, archive, entrypoints, outputDir, stripRoot = false }) {
  const archivePath = path.join(outputDir, archive)
  const files = await listTreeFiles(rootDir, stripRoot)
  const source = tar.c(
    {
      cwd: stripRoot ? rootDir : path.dirname(rootDir),
      noDirRecurse: true,
      noMtime: true,
      portable: true
    },
    listTarEntries(rootDir, stripRoot)
  )
  const metadata = await writeZstdArchive(source, archivePath)
  return { kind: 'tree', version, compression: 'zstd', archive, ...metadata, entrypoints, files }
}

function emptyManifest(platform, arch) {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, platform, arch, artifacts: {} }
}

function readManifest(outputDir, platform, arch) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, MANIFEST_FILE), 'utf8'))
    if (
      manifest.schemaVersion === MANIFEST_SCHEMA_VERSION &&
      manifest.platform === platform &&
      manifest.arch === arch &&
      manifest.artifacts &&
      typeof manifest.artifacts === 'object'
    ) {
      return manifest
    }
  } catch {
    // Missing or stale manifests are rebuilt from the pinned tool definitions.
  }
  return emptyManifest(platform, arch)
}

function writeManifest(outputDir, manifest) {
  const manifestPath = path.join(outputDir, MANIFEST_FILE)
  const tmpPath = `${manifestPath}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    fs.rmSync(manifestPath, { force: true })
    fs.renameSync(tmpPath, manifestPath)
  } finally {
    fs.rmSync(tmpPath, { force: true })
  }
}

function artifactArchiveEntries(artifact) {
  if (!artifact) return []
  return artifact.kind === 'files'
    ? artifact.files.map((file) => ({ archive: file.archive, sha256: file.archiveSha256 }))
    : [{ archive: artifact.archive, sha256: artifact.archiveSha256 }]
}

function singleFileCompression() {
  // The outer installer/package already compresses single-file native payloads.
  return 'none'
}

function removeSupersededArchives(outputDir, previousArtifact, nextArtifact) {
  const nextArchives = new Set(artifactArchiveEntries(nextArtifact).map(({ archive }) => archive))
  for (const { archive } of artifactArchiveEntries(previousArtifact)) {
    if (!nextArchives.has(archive)) fs.rmSync(path.join(outputDir, archive), { force: true })
  }
}

function isBundledArtifactCurrent(tool, pkg, artifact, outputDir, platform) {
  if (!artifact || artifact.version !== tool.version) return false
  if (pkg.archive === 'zip-tree') {
    return (
      artifact.kind === 'tree' &&
      artifact.compression === 'zstd' &&
      artifact.entrypoints?.length === pkg.binaries.length &&
      artifact.entrypoints.every((entrypoint) => pkg.binaries.includes(entrypoint)) &&
      Array.isArray(artifact.files) &&
      artifact.files.length > 0 &&
      artifact.entrypoints.every((entrypoint) => artifact.files.some((file) => file.path === entrypoint)) &&
      fs.existsSync(path.join(outputDir, artifact.archive))
    )
  }
  if (artifact.kind !== 'files' || artifact.files.length !== pkg.binaries.length) return false
  return pkg.binaries.every((binary) => {
    const file = artifact.files.find((candidate) => candidate.output === binary)
    const expectedCompression = platform ? singleFileCompression(platform) : file?.compression || 'zstd'
    return file && file.compression === expectedCompression && fs.existsSync(path.join(outputDir, file.archive))
  })
}

function removeRawToolFiles(pkg, outputDir) {
  if (pkg.archive === 'zip-tree') {
    fs.rmSync(path.join(outputDir, pkg.dir), { recursive: true, force: true })
  } else {
    for (const binary of pkg.binaries) fs.rmSync(path.join(outputDir, binary), { force: true })
  }
}

function removeIntermediateToolFiles(pkg, outputDir, compression) {
  if (pkg.archive === 'zip-tree' || compression === 'zstd') removeRawToolFiles(pkg, outputDir)
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

async function downloadTool(tool, platformKey, outputDir, previousArtifact) {
  const pkg = tool.packages[platformKey]
  if (!pkg) {
    if (tool.required) {
      throw new Error(`[${tool.name}] No binary for "${platformKey}". Add an entry to packages.`)
    }
    console.log(`[${tool.name}] No binary for "${platformKey}", skipping`)
    return null
  }

  const platform = platformKey.split('-')[0]
  const compression = pkg.archive === 'zip-tree' ? 'zstd' : singleFileCompression(platform)

  if (isBundledArtifactCurrent(tool, pkg, previousArtifact, outputDir, platform)) {
    const archivesMatch = await artifactArchivesMatch(previousArtifact, outputDir)
    if (archivesMatch) {
      removeIntermediateToolFiles(pkg, outputDir, compression)
      fs.rmSync(path.join(outputDir, tool.versionFile), { force: true })
      console.log(`[${tool.name}] ${tool.version} bundled payload already exists`)
      return previousArtifact
    }
    console.warn(`[${tool.name}] Cached compressed payload failed checksum verification; rebuilding`)
  }

  const binaryPaths = pkg.binaries.map((binary) => path.join(outputDir, binary))
  const primaryDest = binaryPaths[0]
  const versionPath = path.join(outputDir, tool.versionFile)

  const rawFilesAreCurrent = isUpToDate(binaryPaths, versionPath, tool.version)
  if (rawFilesAreCurrent) {
    for (const binaryPath of binaryPaths) chmodExec(binaryPath)
    console.log(`[${tool.name}] ${tool.version} already installed`)
    // The raw files are an intermediate cache only. They are compressed below.
  }

  if (!rawFilesAreCurrent) {
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
  }

  const artifact =
    pkg.archive === 'zip-tree'
      ? await bundleTreeArtifact({
          version: tool.version,
          rootDir: path.join(outputDir, pkg.dir),
          archive: `${tool.name}.tar.zst`,
          entrypoints: pkg.binaries,
          outputDir
        })
      : await bundleFilesArtifact({
          version: tool.version,
          files: pkg.binaries.map((binary) => ({
            source: path.join(outputDir, binary),
            output: binary,
            archive: compression === 'none' ? binary : `${binary}.zst`,
            compression
          })),
          outputDir
        })

  removeIntermediateToolFiles(pkg, outputDir, compression)
  fs.rmSync(versionPath, { force: true })
  removeSupersededArchives(outputDir, previousArtifact, artifact)
  console.log(`[${tool.name}] Bundled ${pkg.binaries.join(', ')} ${tool.version} (${compression})`)
  return artifact
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const platform = process.argv[2] || process.platform
  const arch = process.argv[3] || process.arch
  const platformKey = `${platform}-${arch}`

  console.log(`Downloading binaries for ${platformKey}...`)

  const outputDir = path.join(__dirname, '..', 'resources', 'binaries', platformKey)
  fs.mkdirSync(outputDir, { recursive: true })
  const previousManifest = readManifest(outputDir, platform, arch)
  const manifest = emptyManifest(platform, arch)

  for (const tool of TOOLS) {
    try {
      const artifact = await downloadTool(tool, platformKey, outputDir, previousManifest.artifacts[tool.name])
      if (artifact) manifest.artifacts[tool.name] = artifact
    } catch (error) {
      if (tool.required) {
        throw error
      }
      console.warn(`[${tool.name}] Download failed (non-fatal): ${error.message}`)
    }
  }

  writeManifest(outputDir, manifest)
  console.log(`All binaries downloaded to ${outputDir}`)
}

/**
 * Assert every bundled binary exists for the target platform. Dev keeps the
 * lenient main() (non-required tools downgrade to a warning), but a release must
 * never ship a half-empty resources/binaries/<platform> — a transient GitHub
 * outage during download would otherwise produce a working build with no rg
 * (search breaks) and no error. Call this from before-pack.js after main().
 */
async function verifyBundledArtifacts(platform, arch, options = {}) {
  // `tools` / `resourcesDir` injectable for tests; production callers pass none.
  const {
    tools = TOOLS,
    resourcesDir = path.join(__dirname, '..', 'resources', 'binaries'),
    requiredArtifactNames = []
  } = options
  const platformKey = `${platform}-${arch}`
  const outputDir = path.join(resourcesDir, platformKey)
  const manifest = readManifest(outputDir, platform, arch)
  const missing = []

  for (const tool of tools) {
    const pkg = tool.packages[platformKey]
    if (!pkg) {
      // isWindowsOnly tools (MinGit) legitimately have no package on macOS/Linux.
      if (!tool.isWindowsOnly) missing.push(`${tool.name} (no package for ${platformKey})`)
      continue
    }
    const artifact = manifest.artifacts[tool.name]
    if (!isBundledArtifactCurrent(tool, pkg, artifact, outputDir, platform)) {
      missing.push(`${tool.name} (missing or stale compressed payload for ${platformKey})`)
      continue
    }
    for (const { archive, sha256 } of artifactArchiveEntries(artifact)) {
      const archivePath = path.join(outputDir, archive)
      if (!sha256 || (await sha256File(archivePath)) !== sha256) {
        missing.push(`${path.join(platformKey, archive)} (checksum mismatch)`)
      }
    }
    if (pkg.archive === 'zip-tree') {
      if (fs.existsSync(path.join(outputDir, pkg.dir))) missing.push(`${tool.name} (raw tree still present)`)
    } else if (pkg.binaries.some((binary) => fs.existsSync(path.join(outputDir, `${binary}.zst`)))) {
      missing.push(`${tool.name} (compressed single-file payload still present)`)
    }
  }

  for (const artifactName of requiredArtifactNames) {
    const artifact = manifest.artifacts[artifactName]
    if (
      !artifact ||
      artifactArchiveEntries(artifact).some(({ archive }) => !fs.existsSync(path.join(outputDir, archive)))
    ) {
      missing.push(`${artifactName} (missing compressed payload for ${platformKey})`)
      continue
    }
    for (const { archive, sha256 } of artifactArchiveEntries(artifact)) {
      if (!sha256 || (await sha256File(path.join(outputDir, archive))) !== sha256) {
        missing.push(`${path.join(platformKey, archive)} (checksum mismatch)`)
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Bundled binaries missing after download for ${platformKey}:\n  ${missing.join('\n  ')}`)
  }
  console.log(`Verified all bundled compressed artifacts for ${platformKey}`)
}

async function artifactArchivesMatch(artifact, outputDir) {
  for (const { archive, sha256 } of artifactArchiveEntries(artifact)) {
    if (!sha256 || (await sha256File(path.join(outputDir, archive))) !== sha256) return false
  }
  return true
}

module.exports = {
  artifactArchiveEntries,
  bundleFilesArtifact,
  bundleTreeArtifact,
  extract,
  readManifest,
  sha256File,
  verifyBundledArtifacts,
  writeManifest,
  singleFileCompression,
  MANIFEST_SCHEMA_VERSION,
  TOOLS
}

// Only auto-download when run directly (node scripts/download-binaries.js ...).
// before-pack.js requires this module for verifyBundledArtifacts without
// triggering a download for the build host's platform.
if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to download binaries:', error.message)
    process.exit(1)
  })
}
