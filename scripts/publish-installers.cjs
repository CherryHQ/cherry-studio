const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')
const { resolveReleaseProfile } = require('./release-profile.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const version = require('../package.json').version
  const profile = resolveReleaseProfile()
  const platform = process.platform
  const arch = process.arch
  if (platform === 'darwin') {
    execFileSync(process.execPath, [path.join(__dirname, 'validate-release-package.cjs'), `${platform}-${arch}`], {
      stdio: 'inherit'
    })
  }
  const extensions =
    platform === 'win32' ? ['-setup.exe'] : platform === 'darwin' ? ['.dmg'] : ['.AppImage', '.deb', '.rpm']
  const directory = path.join(root, 'dist')
  const artifacts = []
  for (const extension of extensions) {
    const candidates = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(extension) && name.includes(version) && name.includes(arch))
    if (candidates.length !== 1)
      throw new Error(`Expected one ${platform}/${arch} ${extension} installer, found ${candidates.length}`)
    const filename = path.join(directory, candidates[0])
    const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux'
    const name = `The-Boss-${version}-${os}-${arch}${extension}`
    const digest = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(filename)) digest.update(chunk)
    const size = fs.statSync(filename).size
    const releaseAsset = path.join(directory, name)
    const usesCanonicalName = path.resolve(filename) === path.resolve(releaseAsset)
    if (!usesCanonicalName) fs.copyFileSync(filename, releaseAsset)
    const tag = `v${version}`
    const uploaded = spawnSync(
      'gh',
      ['release', 'upload', tag, releaseAsset, '--repo', process.env.GITHUB_REPOSITORY, '--clobber'],
      { encoding: 'utf8' }
    )
    process.stdout.write(uploaded.stdout || '')
    process.stderr.write(uploaded.stderr || '')
    if (!usesCanonicalName) fs.rmSync(releaseAsset)
    if (uploaded.status !== 0) throw new Error(`GitHub Release rejected ${name}`)
    const url = `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/download/${tag}/${name}`
    let signing = platform === 'darwin' ? 'unsigned (not notarized)' : 'unsigned'
    if (platform === 'win32' && process.env.HAS_SIGNING === 'true') {
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-AuthenticodeSignature -LiteralPath $env:BOSS_INSTALLER | Select-Object -ExpandProperty Status'
        ],
        { env: { ...process.env, BOSS_INSTALLER: filename }, encoding: 'utf8' }
      ).trim()
      signing = output === 'Valid' ? 'signed' : `Authenticode: ${output}`
    } else if (platform === 'darwin') {
      const app = path.join(directory, arch === 'arm64' ? 'mac-arm64' : 'mac', 'The Boss.app')
      try {
        execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' })
        const detail = spawnSync('codesign', ['-d', '--verbose=4', app], { encoding: 'utf8' })
        const stapled = spawnSync('xcrun', ['stapler', 'validate', app], { encoding: 'utf8' })
        signing =
          detail.stderr.includes('Authority=Developer ID Application') && stapled.status === 0
            ? 'Developer ID (notarized)'
            : detail.stderr.includes('Authority=')
              ? 'signed (not notarized)'
              : 'ad-hoc (not notarized)'
      } catch {
        signing = process.env.HAS_SIGNING === 'true' ? 'signature invalid' : 'unsigned (not notarized)'
      }
    }
    artifacts.push({ name, size, sha256: digest.digest('hex'), url, signing, profile: profile.id })
    console.log(`Published ${name}: ${url}`)
  }
  fs.writeFileSync(
    path.join(root, `installers-${platform}-${arch}.json`),
    JSON.stringify(
      {
        platform,
        arch,
        version,
        profile: profile.id,
        features: { uar: profile.uarEnabled },
        source: process.env.GITHUB_SHA,
        artifacts
      },
      null,
      2
    ) + '\n'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
