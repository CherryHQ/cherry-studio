const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { RETAINED_NATIVE_TOOLS, resolveReleaseProfile } = require('./release-profile.cjs')
const {
  assertPackagedUarPayloadAbsent,
  getPackagedBinaryDirectory,
  verifyAndProbePackagedUarPayload
} = require('./uar-payload-integrity.cjs')

const root = path.resolve(__dirname, '..')
const platformKey = process.argv[2]
const nativePlatformKey = `${process.platform}-${process.arch}`
const version = require('../package.json').version
const profile = resolveReleaseProfile()

if (!profile.supportedPlatforms.includes(platformKey)) {
  throw new Error(`usage: node scripts/validate-release-package.cjs <${profile.supportedPlatforms.join('|')}>`)
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

function verifyPackagedApplication(resourcesDir) {
  const appAsar = path.join(resourcesDir, 'app.asar')
  const appAsarStat = fs.statSync(appAsar, { throwIfNoEntry: false })
  if (!appAsarStat?.isFile() || appAsarStat.size === 0) {
    throw new Error('Packaged application is missing its app.asar payload')
  }

  const integration = require('../build/integration-artifacts.json')
  const binaryDirectory = getPackagedBinaryDirectory(resourcesDir, platformKey)
  for (const name of RETAINED_NATIVE_TOOLS) {
    const tool = integration.tools.find((candidate) => candidate.name === name)
    const artifact = tool?.packages?.[platformKey]
    if (!tool || !artifact) throw new Error(`Release manifest is missing ${name} for ${platformKey}`)
    for (const filename of artifact.binaries) {
      const packaged = path.join(binaryDirectory, ...filename.split('/'))
      const stat = fs.statSync(packaged, { throwIfNoEntry: false })
      if (!stat?.isFile() || stat.size === 0) throw new Error(`Packaged ${name} payload is missing: ${filename}`)
    }
    const marker = path.join(binaryDirectory, `.${name}-version`)
    if (fs.readFileSync(marker, 'utf8').trim() !== tool.version) {
      throw new Error(`Packaged ${name} version marker does not match ${tool.version}`)
    }
  }

  if (profile.uarEnabled) verifyAndProbePackagedUarPayload(resourcesDir, platformKey)
  else assertPackagedUarPayloadAbsent(resourcesDir, platformKey)
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
  const sealedResources = path.join(app, 'Contents', '_CodeSignature', 'CodeResources')
  const sealedResourcesStat = fs.statSync(sealedResources, { throwIfNoEntry: false })
  if (!sealedResourcesStat?.isFile() || sealedResourcesStat.size === 0) {
    throw new Error('Mounted DMG application is missing its sealed code resources')
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=4', app], { stdio: 'inherit' })
  verifyPackagedApplication(path.join(app, 'Contents', 'Resources'))
}

function validateDmg() {
  const artifact = findArtifact(`-${process.arch}.dmg`)
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
  const artifact = findArtifact(`-${process.arch}-setup.exe`)
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'the-boss-installer-'))
  const installation = path.join(temporary, 'The Boss')
  try {
    execFileSync(artifact, ['/S', `/D=${installation}`], { stdio: 'inherit', timeout: 300_000, windowsHide: true })
    const executable = path.join(installation, 'The Boss.exe')
    const executableStat = fs.statSync(executable, { throwIfNoEntry: false })
    if (!executableStat?.isFile() || executableStat.size === 0) {
      throw new Error('NSIS installer contains no usable application executable')
    }
    verifyPackagedApplication(path.join(installation, 'resources'))
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

if (platformKey.startsWith('darwin-')) validateDmg()
else validateWindowsInstaller()

process.stdout.write(`Validated ${platformKey} installer and ${profile.id} application image\n`)
