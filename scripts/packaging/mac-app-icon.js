const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ICON_NAME = 'AppIcon'

function hasIconCompiler() {
  try {
    execFileSync('xcrun', ['--find', 'actool'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// A single .icns holds one rendition, so macOS 26 reads the light, dark, clear and
// tinted variants from a compiled asset catalog. Only Xcode compiles build/AppIcon.icon.
exports.installMacAppIcon = function installMacAppIcon({ projectRoot, appOutDir, productFilename }) {
  if (!hasIconCompiler()) {
    process.stdout.write('Skipped the macOS app icon variants: Xcode is not installed\n')
    return
  }

  const source = path.join(projectRoot, 'build', `${ICON_NAME}.icon`)
  const contents = path.join(appOutDir, `${productFilename}.app`, 'Contents')
  const infoPlist = path.join(contents, 'Info.plist')
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-studio-app-icon-'))

  try {
    const minimumSystemVersion = execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', infoPlist], {
      encoding: 'utf8'
    }).trim()

    execFileSync(
      'xcrun',
      [
        'actool',
        '--compile',
        outputDir,
        '--platform',
        'macosx',
        '--target-device',
        'mac',
        '--minimum-deployment-target',
        minimumSystemVersion,
        '--app-icon',
        ICON_NAME,
        '--output-partial-info-plist',
        path.join(outputDir, 'partial.plist'),
        '--output-format',
        'human-readable-text',
        source
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] }
    )
    fs.copyFileSync(path.join(outputDir, 'Assets.car'), path.join(contents, 'Resources', 'Assets.car'))

    // macOS reads the catalog only when the bundle declares its icon name, and
    // electron-builder's extendInfo list form writes numbered keys instead.
    try {
      execFileSync('plutil', ['-replace', 'CFBundleIconName', '-string', ICON_NAME, infoPlist], { stdio: 'ignore' })
    } catch {
      execFileSync('plutil', ['-insert', 'CFBundleIconName', '-string', ICON_NAME, infoPlist], { stdio: 'ignore' })
    }
  } catch (error) {
    // An Xcode older than 26 cannot compile an Icon Composer document; the .icns still ships.
    process.stdout.write(`Skipped the macOS app icon variants: ${error.message}\n`)
    return
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true })
  }

  process.stdout.write(`Installed the macOS app icon variants from build/${ICON_NAME}.icon\n`)
}
