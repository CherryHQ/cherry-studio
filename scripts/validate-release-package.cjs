const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { verifyAndProbePackagedUarPayload } = require('./uar-payload-integrity.cjs')

const root = path.resolve(__dirname, '..')
const platformKey = process.argv[2]
const nativePlatformKey = `${process.platform}-${process.arch}`
const version = require('../package.json').version

if (!['darwin-arm64', 'win32-x64'].includes(platformKey)) {
  throw new Error('usage: node scripts/validate-release-package.cjs <darwin-arm64|win32-x64>')
}
if (platformKey !== nativePlatformKey) {
  throw new Error(`Release package ${platformKey} must be validated on its native ${nativePlatformKey} runner`)
}

function findArtifact(suffix) {
  const matches = fs
    .readdirSync(path.join(root, 'dist'))
    .filter((name) => name.includes(version) && name.toLowerCase().endsWith(suffix.toLowerCase()))
  if (matches.length !== 1) throw new Error(`Expected one ${platformKey} ${suffix} artifact, found ${matches.length}`)
  return path.join(root, 'dist', matches[0])
}

function verifyApplicationBundle(app) {
  const info = path.join(app, 'Contents', 'Info.plist')
  execFileSync('plutil', ['-lint', info], { stdio: 'inherit' })
  const executableName = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', info], {
    encoding: 'utf8'
  }).trim()
  const executable = path.join(app, 'Contents', 'MacOS', executableName)
  const executableStat = fs.statSync(executable, { throwIfNoEntry: false })
  if (!executableStat?.isFile() || executableStat.size === 0 || (executableStat.mode & 0o111) === 0) {
    throw new Error('Mounted DMG contains no usable application executable')
  }
  const signature = path.join(app, 'Contents', '_CodeSignature')
  if (fs.existsSync(signature)) execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  verifyAndProbePackagedUarPayload(path.join(app, 'Contents', 'Resources'), platformKey)
}

function validateDmg() {
  const artifact = findArtifact('-arm64.dmg')
  execFileSync('hdiutil', ['verify', artifact], { stdio: 'inherit', timeout: 120_000 })
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'the-boss-dmg-'))
  const mount = path.join(temporary, 'mounted')
  fs.mkdirSync(mount)
  let mounted = false
  try {
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, artifact], {
      stdio: 'inherit',
      timeout: 120_000
    })
    mounted = true
    const apps = fs
      .readdirSync(mount)
      .filter((name) => name.endsWith('.app'))
      .map((name) => path.join(mount, name))
      .filter((filename) => fs.statSync(filename).isDirectory())
    if (apps.length !== 1) throw new Error(`Expected one application bundle in the DMG, found ${apps.length}`)
    verifyApplicationBundle(apps[0])
  } finally {
    try {
      if (mounted) execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit', timeout: 60_000 })
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  }
}

function validateWindowsInstaller() {
  const artifact = findArtifact('-x64-setup.exe')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'the-boss-installer-'))
  const installation = path.join(temporary, 'The Boss')
  try {
    execFileSync(artifact, ['/S', `/D=${installation}`], { stdio: 'inherit', timeout: 300_000, windowsHide: true })
    const executable = path.join(installation, 'The Boss.exe')
    const executableStat = fs.statSync(executable, { throwIfNoEntry: false })
    if (!executableStat?.isFile() || executableStat.size === 0) {
      throw new Error('NSIS installer contains no usable application executable')
    }
    verifyAndProbePackagedUarPayload(path.join(installation, 'resources'), platformKey)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

if (platformKey === 'darwin-arm64') validateDmg()
else validateWindowsInstaller()

process.stdout.write(`Validated ${platformKey} installer, application image, and UAR sidecar payload\n`)
