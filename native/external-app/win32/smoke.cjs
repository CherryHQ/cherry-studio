const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { copyFileSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const directory = mkdtempSync(path.join(os.tmpdir(), 'cherry-icon-smoke-'))
const suffix = `${process.pid}-${Date.now()}`
const extension = `.cherry-icon-${suffix}`
const classes = 'HKCU\\Software\\Classes\\'
const keys = [extension]
function set(key, value, name) {
  execFileSync(
    'reg.exe',
    ['add', classes + key, name ? '/v' : '/ve', ...(name ? [name] : []), '/t', 'REG_SZ', '/d', value, '/f'],
    { stdio: 'pipe' }
  )
}
try {
  const fixture = path.join(directory, `中文 file${extension}`)
  writeFileSync(fixture, 'Native icon association fixture')
  for (const index of [0, 1]) {
    const executable = path.join(directory, `cherry-icon-${index}-${suffix}.exe`)
    copyFileSync(path.join(process.env.SystemRoot, 'System32/notepad.exe'), executable)
    const id = `CherryIconSmoke.${suffix}.${index}`
    keys.push(id)
    set(id, `Cherry icon ${index}`)
    set(`${id}\\shell\\open\\command`, `"${executable}" "%1"`)
    set(`${id}\\DefaultIcon`, `"${process.env.SystemRoot}\\System32\\shell32.dll",${index}`)
    const appKey = `Applications\\${path.basename(executable)}`
    keys.push(appKey)
    set(`${appKey}\\shell\\open\\command`, `"${executable}" "%1"`)
    set(`${appKey}\\DefaultIcon`, `"${process.env.SystemRoot}\\System32\\shell32.dll",${index}`)
    set(`${appKey}\\SupportedTypes`, '', extension)
    set(`${extension}\\OpenWithProgids`, '', id)
    if (index === 0) set(extension, id)
  }
  const listing = JSON.parse(
    execFileSync(process.execPath, [path.resolve(__dirname, '../smoke.cjs'), fixture], {
      encoding: 'utf8',
      timeout: 20000
    })
  )
  const icons = [0, 1].map((index) => {
    const application = listing.applications.find((entry) =>
      entry.id.toLowerCase().endsWith(`cherry-icon-${index}-${suffix}.exe`)
    )
    assert(application?.iconDataUrl?.startsWith('data:image/png;base64,'), `Missing declared resource icon ${index}`)
    const png = Buffer.from(application.iconDataUrl.split(',')[1], 'base64')
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), 32)
    assert.equal(png.readUInt32BE(20), 32)
    return png
  })
  assert.notDeepEqual(
    icons[0],
    icons[1],
    'Different declared resource indices must not use the identical executable icon'
  )
  process.stdout.write(
    'Windows returned distinct indexed resource icons for identical executables through real per-user associations.\n'
  )
} finally {
  for (const key of keys.reverse()) execFileSync('reg.exe', ['delete', classes + key, '/f'], { stdio: 'pipe' })
  rmSync(directory, { recursive: true, force: true })
}
