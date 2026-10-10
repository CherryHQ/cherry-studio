const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const semver = require('semver')
const { EDITIONS } = require('../release/edition')

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) })
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination, { flags: 'wx' }))
}

async function seedBase(output, channel, edition, version) {
  const headers = process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}
  const response = await fetch('https://api.github.com/repos/CherryHQ/cherry-studio/releases?per_page=100', { headers })
  if (!response.ok) throw new Error(`Cannot discover delta base: ${response.status}`)
  const releases = (await response.json())
    .filter(
      (release) =>
        !release.draft &&
        semver.valid(release.tag_name) &&
        semver.lt(release.tag_name, version) &&
        Boolean(semver.prerelease(release.tag_name)) === Boolean(semver.prerelease(version))
    )
    .sort((a, b) => semver.rcompare(a.tag_name, b.tag_name))
  const release = releases.find((item) => item.assets.some((asset) => asset.name === `releases.${channel}.json`))
  if (!release) return
  const feedResponse = await fetch(
    `https://github.com/CherryHQ/cherry-studio/releases/download/${release.tag_name}/releases.${channel}.json`
  )
  if (!feedResponse.ok) throw new Error(`Cannot read delta base feed: ${feedResponse.status}`)
  const feed = await feedResponse.json()
  const base = feed.Assets.find(
    (asset) =>
      asset.Type === 'Full' &&
      asset.Version === release.tag_name.slice(1) &&
      asset.PackageId === `CherryStudio-${edition}`
  )
  if (!base || !/^[\w.+-]+-full\.nupkg$/.test(base.FileName) || !/^[a-f\d]{64}$/i.test(base.SHA256))
    throw new Error('Invalid delta base feed')
  const filename = path.join(output, base.FileName)
  await download(
    `https://github.com/CherryHQ/cherry-studio/releases/download/${release.tag_name}/${base.FileName}`,
    filename
  )
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk)
  if (fs.statSync(filename).size !== base.Size || hash.digest('hex') !== base.SHA256.toLowerCase())
    throw new Error('Delta base checksum mismatch')
}

async function main() {
  const edition = process.argv[2] || 'global'
  if (!EDITIONS.includes(edition)) throw new Error('Unsupported edition')
  const os = { win32: 'win', darwin: 'osx', linux: 'linux' }[process.platform]
  if (!os) throw new Error('Unsupported build platform')
  const version = require('../../package.json').version
  const pnpm = 'pnpm'
  const runPnpm = (args, env) =>
    execFileSync(pnpm, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  const env = { ...process.env, CHERRY_EDITION: edition, CHERRY_UPDATE_BACKEND: 'velopack' }
  runPnpm(['exec', 'electron-vite', 'build'], env)
  runPnpm(['run', 'build:utility-process'], env)
  for (const arch of ['x64', 'arm64']) {
    const channel = `${os}-${arch}-${edition}`
    const output = fs.mkdtempSync(path.resolve('dist', `velopack-${channel}-`))
    await seedBase(output, channel, edition, version)
    const args = [
      'pack',
      '--packId',
      `CherryStudio-${edition}`,
      '--packVersion',
      version,
      '--packTitle',
      edition === 'cn' ? 'Cherry Studio CN' : 'Cherry Studio',
      '--channel',
      channel,
      '--runtime',
      `${os}-${arch}`,
      '--outputDir',
      output,
      '--skipVeloAppCheck',
      '--yes',
      '--skip-updates'
    ]
    if (os === 'win')
      args.push(
        '--noPortable',
        '--mainExe',
        'Cherry Studio.exe',
        '--icon',
        'build/icon.ico',
        '--signTemplate',
        `"${process.execPath}" "${path.resolve('scripts/packaging/velopack-sign.js')}" "{{file}}"`
      )
    if (os === 'osx') args.push('--noInst', '--mainExe', 'Cherry Studio')
    if (os === 'linux') args.push('--mainExe', 'CherryStudio', '--icon', 'build/icon.png')
    const builderOutput = path.join(output, 'app')
    const builder = [
      'exec',
      'electron-builder',
      '--dir',
      `--${arch}`,
      '--publish',
      'never',
      '--config',
      edition === 'cn' ? 'electron-builder.cn.config.cjs' : 'electron-builder.yml',
      `-c.directories.output=${path.relative(process.cwd(), builderOutput)}`
    ]
    if (os === 'osx') builder.push('-c.afterSign=scripts/packaging/velopack-after-sign.js')
    runPnpm(builder, { ...env, CHERRY_VPK_ARGS: JSON.stringify(args) })
    if (os !== 'osx') {
      const unpacked =
        os === 'win'
          ? arch === 'x64'
            ? 'win-unpacked'
            : 'win-arm64-unpacked'
          : arch === 'x64'
            ? 'linux-unpacked'
            : 'linux-arm64-unpacked'
      execFileSync('vpk', [...args, '--packDir', path.join(builderOutput, unpacked)], { stdio: 'inherit' })
    }
    const feedName = `releases.${channel}.json`
    const feed = JSON.parse(fs.readFileSync(path.join(output, feedName), 'utf8'))
    feed.Assets = feed.Assets.filter((asset) => asset.Version === version)
    if (!feed.Assets.some((asset) => asset.Type === 'Full')) throw new Error('Missing complete Velopack package')
    for (const asset of feed.Assets)
      fs.copyFileSync(path.join(output, asset.FileName), path.join('dist', asset.FileName))
    const extension = { win: 'exe', osx: 'zip', linux: 'AppImage' }[os]
    const installers = fs.readdirSync(output).filter((file) => file.endsWith(`.${extension}`))
    if (installers.length !== 1) throw new Error('Expected one Velopack installation artifact')
    fs.copyFileSync(
      path.join(output, installers[0]),
      path.join('dist', `CherryStudio-${edition}-${version}-${os}-${arch}-Velopack.${extension}`)
    )
    fs.writeFileSync(path.join('dist', feedName), JSON.stringify(feed))
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
