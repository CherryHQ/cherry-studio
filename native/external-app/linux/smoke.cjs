const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

async function smoke() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cherry-external-app-'))
  try {
    const data = path.join(directory, 'data')
    const config = path.join(directory, 'config')
    const applications = path.join(data, 'applications')
    mkdirSync(applications, { recursive: true })
    mkdirSync(config)
    const theme = path.join(data, 'icons/hicolor')
    const icons = path.join(theme, '32x32/apps')
    mkdirSync(icons, { recursive: true })
    writeFileSync(
      path.join(theme, 'index.theme'),
      '[Icon Theme]\nName=Hicolor\nDirectories=32x32/apps\n\n[32x32/apps]\nSize=32\nType=Fixed\nContext=Applications\n'
    )
    const themedIcon = path.join(icons, 'cherry-native-smoke.svg')
    const absoluteIcon = path.join(directory, 'absolute icon.svg')
    writeFileSync(
      themedIcon,
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#ff0000" d="M0 0h32v32H0z"/></svg>'
    )
    writeFileSync(
      absoluteIcon,
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#0000ff" d="M0 0h32v32H0z"/></svg>'
    )
    const fixture = path.join(directory, '中文 file.txt')
    const marker = path.join(directory, 'opened')
    const launcher = path.join(directory, 'capture.cjs')
    writeFileSync(fixture, 'external app native smoke\n')
    writeFileSync(launcher, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.argv[2])`)
    const handlers = [
      ['cherry-native-smoke.desktop', 'cherry-native-smoke'],
      ['cherry-absolute-icon.desktop', absoluteIcon],
      ['cherry-missing-icon.desktop', 'cherry-no-such-icon'],
      ['cherry-broken-icon.desktop', path.join(directory, 'broken.png')]
    ]
    writeFileSync(path.join(directory, 'broken.png'), 'not an image')
    for (const [id, icon] of handlers)
      writeFileSync(
        path.join(applications, id),
        [
          '[Desktop Entry]',
          'Type=Application',
          'Name=Cherry native smoke',
          `Exec="${process.execPath}" "${launcher}" %f`,
          `Icon=${icon}`,
          'MimeType=text/plain;',
          'NoDisplay=false'
        ].join('\n')
      )
    writeFileSync(
      path.join(config, 'mimeapps.list'),
      `[Default Applications]\ntext/plain=cherry-native-smoke.desktop;\n[Added Associations]\ntext/plain=${handlers.map(([id]) => id).join(';')};\n`
    )
    const electron = process.argv[2]
    const result = spawnSync(
      electron ?? process.execPath,
      [
        ...(electron ? ['--no-sandbox', ...process.argv.slice(3)] : []),
        path.resolve(__dirname, electron ? '../electron-smoke.cjs' : '../smoke.cjs'),
        fixture,
        'cherry-native-smoke.desktop'
      ],
      {
        env: { ...process.env, XDG_DATA_HOME: data, XDG_CONFIG_HOME: config },
        encoding: 'utf8',
        timeout: 15000
      }
    )
    assert.equal(result.status, 0, result.stderr)
    const listing = JSON.parse(result.stdout)
    const png = (id) => {
      const app = listing.applications.find((entry) => entry.id === id)
      assert(app?.iconDataUrl?.startsWith('data:image/png;base64,'), `Missing icon for ${id}`)
      return Buffer.from(app.iconDataUrl.split(',')[1], 'base64')
    }
    const red = png('cherry-native-smoke.desktop')
    const blue = png('cherry-absolute-icon.desktop')
    for (const image of [red, blue]) {
      assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert.equal(image.readUInt32BE(16), 32)
      assert.equal(image.readUInt32BE(20), 32)
    }
    assert.notDeepEqual(red, blue, 'Theme and absolute icons must retain distinct artwork')
    for (const id of ['cherry-missing-icon.desktop', 'cherry-broken-icon.desktop']) {
      const app = listing.applications.find((entry) => entry.id === id)
      assert(app, 'An unreadable icon must not hide its application')
      assert.equal(app.iconDataUrl, undefined)
    }
    for (let attempt = 0; attempt < 100 && !existsSync(marker); attempt++) await delay(50)
    assert.equal(readFileSync(marker, 'utf8'), fixture)
    process.stdout.write(
      'GIO enumerated and opened the Unicode fixture; themed and absolute SVG icons became distinct PNGs; missing and corrupt icons preserved their handlers.\n'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
smoke().catch((error) => {
  process.stderr.write(`${error.stack}\n`)
  process.exitCode = 1
})
