const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')

async function main() {
  const root = path.resolve(__dirname, '..')
  const version = require('../package.json').version
  const platform = process.platform
  const arch = process.arch
  const extensions = platform === 'win32' ? ['-setup.exe'] : platform === 'darwin' ? ['.dmg'] : ['.AppImage', '.deb', '.rpm']
  const directory = path.join(root, 'dist')
  const artifacts = []
  for (const extension of extensions) {
    const candidates = fs.readdirSync(directory).filter((name) => name.endsWith(extension) && name.includes(version) && name.includes(arch))
    if (candidates.length !== 1) throw new Error(`Expected one ${platform}/${arch} ${extension} installer, found ${candidates.length}`)
    const name = candidates[0]
    const filename = path.join(directory, name)
    const digest = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(filename)) digest.update(chunk)
    const form = new FormData()
    form.append('file', await fs.openAsBlob(filename), name)
    const gateway = process.env.IPFS_API || 'https://ipfs.prometheusags.ai'
    const response = await fetch(`${gateway}/api/v0/add?pin=true&cid-version=1&progress=false`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(1800000)
    })
    if (!response.ok) throw new Error(`IPFS rejected ${name}: HTTP ${response.status}`)
    const entry = JSON.parse((await response.text()).trim().split('\n').at(-1))
    if (!/^b[a-z2-7]+$/.test(entry.Hash)) throw new Error(`Invalid IPFS CID for ${name}`)
    const url = `${gateway}/ipfs/${entry.Hash}`
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(120000) })
    if (!head.ok) throw new Error(`Published installer unavailable: ${name}, HTTP ${head.status}`)
    let signing = 'unsigned'
    if (platform === 'win32') {
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-AuthenticodeSignature -LiteralPath $env:BOSS_INSTALLER | Select-Object -ExpandProperty Status'], { env: { ...process.env, BOSS_INSTALLER: filename }, encoding: 'utf8' }).trim()
      signing = output === 'Valid' ? 'signed' : `Authenticode: ${output}`
    } else if (platform === 'darwin') {
      const app = path.join(directory, arch === 'arm64' ? 'mac-arm64' : 'mac', 'The Boss.app')
      try {
        execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' })
        const detail = spawnSync('codesign', ['-d', '--verbose=4', app], { encoding: 'utf8' })
        signing = detail.stderr.includes('Authority=') ? 'signed (not notarized)' : 'ad-hoc (not notarized)'
      } catch { signing = 'unsigned or signature invalid' }
    }
    artifacts.push({ name, size: fs.statSync(filename).size, sha256: digest.digest('hex'), url, signing })
    console.log(`Published ${name}: ${url}`)
  }
  fs.writeFileSync(path.join(root, `installers-${platform}-${arch}.json`), JSON.stringify({ platform, arch, version, source: process.env.GITHUB_SHA, artifacts }, null, 2) + '\n')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
