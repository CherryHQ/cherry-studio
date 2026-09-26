const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const platform = process.platform
const arch = process.arch
const localManifest = path.join(root, `installers-${platform}-${arch}.json`)
const manifest = JSON.parse(fs.readFileSync(localManifest, 'utf8'))
const repository = process.env.GITHUB_REPOSITORY
const tag = `v${manifest.version}`
const manifestAsset = `release-platform-${tag}-${manifest.profile}-${platform}-${arch}-${manifest.source}.json`
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'the-boss-release-platform-'))
const immutableManifest = path.join(temporaryDirectory, manifestAsset)

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

try {
  if (
    manifest.platform !== platform ||
    manifest.arch !== arch ||
    manifest.source !== process.env.GITHUB_SHA ||
    manifest.version !== require('../package.json').version ||
    !/^[a-f0-9]{40}$/.test(manifest.source) ||
    manifest.artifacts?.length !== 1
  ) {
    throw new Error('Platform manifest does not match the native release job')
  }
  const existing = spawnSync(
    'gh',
    ['release', 'download', tag, '--repo', repository, '--pattern', manifestAsset, '--dir', temporaryDirectory],
    { encoding: 'utf8' }
  )
  const downloaded = path.join(temporaryDirectory, manifestAsset)
  if (existing.status === 0) {
    if (digest(downloaded) !== digest(localManifest)) {
      throw new Error(`GitHub Release already contains different bytes for ${manifestAsset}`)
    }
  } else {
    fs.copyFileSync(localManifest, immutableManifest)
    execFileSync('gh', ['release', 'upload', tag, immutableManifest, '--repo', repository], { stdio: 'inherit' })
  }

  const payload = {
    event_type: 'boss_release_platform_published',
    client_payload: {
      repository,
      tag,
      version: manifest.version,
      profile: manifest.profile,
      platform,
      arch,
      manifestAsset
    }
  }
  execFileSync('gh', ['api', `repos/${repository}/dispatches`, '--input', '-'], {
    input: JSON.stringify(payload),
    stdio: ['pipe', 'inherit', 'inherit']
  })
  console.log(`Queued serialized publication for ${platform}-${arch}: ${manifestAsset}`)
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
