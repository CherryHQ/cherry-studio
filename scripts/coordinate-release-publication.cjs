const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { resolveReleaseProfile } = require('./release-profile.cjs')

const root = path.resolve(__dirname, '..')
const repository = process.env.GITHUB_REPOSITORY
const branch = process.env.RELEASE_BRANCH
const tag = process.env.RELEASE_TAG
const expectedVersion = process.env.RELEASE_VERSION
const expectedProfile = process.env.RELEASE_PROFILE
const expectedPlatform = process.env.RELEASE_PLATFORM
const expectedArch = process.env.RELEASE_ARCH
const manifestAsset = process.env.RELEASE_MANIFEST_ASSET
const landingRepository = process.env.LANDING_REPOSITORY
const landingToken = process.env.LANDING_DISPATCH_TOKEN
const platformKey = `${expectedPlatform}-${expectedArch}`

function required(value, name) {
  if (!value) throw new Error(`${name} is required for release publication`)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...options })
}

for (const [name, value] of Object.entries({
  GITHUB_REPOSITORY: repository,
  RELEASE_BRANCH: branch,
  RELEASE_TAG: tag,
  RELEASE_VERSION: expectedVersion,
  RELEASE_PROFILE: expectedProfile,
  RELEASE_PLATFORM: expectedPlatform,
  RELEASE_ARCH: expectedArch,
  RELEASE_MANIFEST_ASSET: manifestAsset,
  LANDING_REPOSITORY: landingRepository,
  LANDING_DISPATCH_TOKEN: landingToken
})) {
  required(value, name)
}
if (!/^[A-Za-z0-9._-]+$/.test(manifestAsset)) throw new Error('Release manifest asset name is invalid')
if (!/^\d+\.\d+\.\d+$/.test(expectedVersion) || tag !== `v${expectedVersion}`) {
  throw new Error('Release tag and version are invalid')
}
if (expectedProfile !== resolveReleaseProfile().id) throw new Error('Release profile does not match the workflow')
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'the-boss-publication-'))
const downloadedManifest = path.join(temporaryDirectory, manifestAsset)

try {
  execFileSync(
    'gh',
    ['release', 'download', tag, '--repo', repository, '--pattern', manifestAsset, '--dir', temporaryDirectory],
    { stdio: 'inherit' }
  )
  const platformManifest = JSON.parse(fs.readFileSync(downloadedManifest, 'utf8'))
  if (
    platformManifest.version !== expectedVersion ||
    platformManifest.profile !== expectedProfile ||
    platformManifest.platform !== expectedPlatform ||
    platformManifest.arch !== expectedArch ||
    !/^[a-f0-9]{40}$/.test(platformManifest.source || '') ||
    platformManifest.features?.uar !== (expectedProfile === 'uar-enabled') ||
    platformManifest.artifacts?.length !== 1
  ) {
    throw new Error('Immutable platform manifest does not match the publication event')
  }
  const expectedAsset = `release-platform-${tag}-${expectedProfile}-${expectedPlatform}-${expectedArch}-${platformManifest.source}.json`
  if (manifestAsset !== expectedAsset)
    throw new Error('Immutable platform manifest asset name does not match its source')

  let published = false
  let lastError
  for (let attempt = 1; attempt <= 3 && !published; attempt += 1) {
    run('git', ['fetch', 'origin', branch])
    run('git', ['reset', '--hard', `origin/${branch}`])
    const packageVersion = require(path.join(root, 'package.json')).version
    if (packageVersion !== expectedVersion) {
      throw new Error(`Publication branch version ${packageVersion} does not match ${expectedVersion}`)
    }
    const manifestsDirectory = path.join(root, 'manifests')
    fs.rmSync(manifestsDirectory, { recursive: true, force: true })
    fs.mkdirSync(manifestsDirectory, { recursive: true })
    fs.copyFileSync(downloadedManifest, path.join(manifestsDirectory, manifestAsset))
    const baseSha = run('git', ['rev-parse', 'HEAD']).trim()
    const releaseEnvironment = {
      ...process.env,
      RELEASE_BASE_SHA: baseSha,
      RELEASE_MANIFEST_FILE: manifestAsset,
      RELEASE_PLATFORMS: platformKey,
      RELEASE_SOURCE_SHA: platformManifest.source
    }
    execFileSync(process.execPath, [path.join(__dirname, 'update-release-entry.cjs')], {
      cwd: root,
      env: releaseEnvironment,
      stdio: 'inherit'
    })
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'commit-release-entry.cjs')], {
        cwd: root,
        env: releaseEnvironment,
        stdio: 'inherit'
      })
      published = true
    } catch (error) {
      lastError = error
      console.error(`Publication attempt ${attempt} lost a branch race; reloading current metadata`)
    }
  }
  if (!published) throw lastError || new Error('Unable to publish release metadata')

  execFileSync('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest'], { stdio: 'inherit' })
  execFileSync(process.execPath, [path.join(__dirname, 'verify-github-release.cjs')], {
    cwd: root,
    env: {
      ...process.env,
      RELEASE_PLATFORMS: platformKey,
      RELEASE_SOURCE_SHA: platformManifest.source
    },
    stdio: 'inherit'
  })

  const dispatch = {
    event_type: 'boss_release_platform_published',
    client_payload: {
      repository,
      tag,
      version: expectedVersion,
      profile: expectedProfile,
      platform: expectedPlatform,
      arch: expectedArch,
      manifestAsset
    }
  }
  execFileSync('gh', ['api', `repos/${landingRepository}/dispatches`, '--input', '-'], {
    env: { ...process.env, GH_TOKEN: landingToken },
    input: JSON.stringify(dispatch),
    stdio: ['pipe', 'inherit', 'inherit']
  })
  console.log(`Published ${platformKey} metadata and dispatched ${landingRepository}`)
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
