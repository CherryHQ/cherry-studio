/**
 * Brand Builder Script
 *
 * This script handles brand customization for Cherry Studio builds.
 * It loads brand configuration from brand.config.json and prepares
 * the build environment with the specified brand settings.
 *
 * Usage:
 *   node scripts/brand-builder.js [brand-profile]
 *
 * Examples:
 *   node scripts/brand-builder.js default    # Default Cherry Studio build
 *   node scripts/brand-builder.js custom     # Custom brand build
 *
 * Environment Variables (set by the script):
 *   - BRAND_PROFILE: The selected brand profile
 *   - ENABLE_TEST_PLAN: Whether test plan feature is enabled
 *   - APP_NAME: Application display name
 *   - APP_DESCRIPTION: Application description
 *   - APP_ID: Application ID (reverse domain notation)
 *   - APP_AUTHOR: Author contact email
 *   - APP_HOMEPAGE: Application homepage URL
 *   - APP_PROTOCOL: Custom protocol scheme
 *   - CUSTOM_BUILD: Set to 'true' for custom builds
 *   - BUILD_BRAND: The brand profile name
 */

const fs = require('fs')
const path = require('path')

// Load brand configuration
function loadBrandConfig() {
  const configPath = path.join(__dirname, '..', 'brand.config.json')
  if (!fs.existsSync(configPath)) {
    console.error('Error: brand.config.json not found')
    process.exit(1)
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  return config
}

// Validate brand profile exists
function validateBrandProfile(config, profile) {
  if (!config[profile]) {
    console.error(`Error: Brand profile "${profile}" not found in brand.config.json`)
    console.error('Available profiles:', Object.keys(config).join(', '))
    process.exit(1)
  }
  return config[profile]
}

// Generate environment variables from brand configuration
function generateEnvVars(brandConfig, profile) {
  const license = brandConfig.license || {}
  const ui = brandConfig.ui || {}
  const update = brandConfig.update || {}
  const envVars = {
    BRAND_PROFILE: profile,
    ENABLE_TEST_PLAN: brandConfig.features.enableTestPlan ? 'true' : 'false',
    APP_NAME: brandConfig.name,
    APP_DESCRIPTION: brandConfig.description,
    APP_ID: brandConfig.appId,
    APP_AUTHOR: brandConfig.author,
    APP_HOMEPAGE: brandConfig.homepage,
    APP_PROTOCOL: brandConfig.protocols.schemes[0],
    CUSTOM_BUILD: profile === 'default' ? 'false' : 'true',
    BUILD_BRAND: profile,
    // AGPL-3.0 Compliance: Source code URL is required for license compliance
    SOURCE_CODE_URL: license.sourceCodeUrl || 'https://github.com/CherryHQ/cherry-studio',
    // UI visibility settings
    CONTACT_EMAIL: ui.contactEmail || brandConfig.author || 'support@cherry-ai.com',
    SHOW_DOCS: ui.showDocs !== false ? 'true' : 'false',
    SHOW_WEBSITE: ui.showWebsite !== false ? 'true' : 'false',
    SHOW_ENTERPRISE: ui.showEnterprise !== false ? 'true' : 'false',
    SHOW_CAREERS: ui.showCareers !== false ? 'true' : 'false',
    GITHUB_REPO_URL: ui.githubRepoUrl || license.sourceCodeUrl || 'https://github.com/CherryHQ/cherry-studio',
    // Update server configuration
    UPDATE_SERVER_URL: update.serverUrl || '',
    UPDATE_CONFIG_URL: update.configUrl || '',
    UPDATE_FEED_URL: update.feedUrl || '',
    UPDATE_MIRROR: update.mirror || 'github'
  }
  return envVars
}

// Generate dynamic electron-builder.yml based on brand configuration
function generateElectronBuilderConfig(brandConfig) {
  const iconMac = brandConfig.assets.iconMac || 'build/icon.icns'
  const iconWin = brandConfig.assets.iconWin || 'build/icon.ico'
  const iconLinux = brandConfig.assets.icon || 'build/icon.png'

  return `appId: ${brandConfig.appId}
productName: ${brandConfig.productName}
electronLanguages:
  - zh-CN
  - zh-TW
  - en-US
  - ja
  - ru
  - zh_CN
  - zh_TW
  - en
  - de
directories:
  buildResources: build
protocols:
  - name: ${brandConfig.protocols.name}
    schemes:
      - ${brandConfig.protocols.schemes[0]}
files:
  - "**/*"
  - "!**/{.vscode,.yarn,.yarn-lock,.github,.cursorrules,.prettierrc}"
  - "!electron.vite.config.{js,ts,mjs,cjs}}"
  - "!.*"
  - "!components.json"
  - "!**/{.eslintignore,.eslintrc.js,.eslintrc.json,.eslintcache,root.eslint.config.js,eslint.config.js,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,eslint.config.mjs,dev-app-update.yml,CHANGELOG.md,README.md,biome.jsonc}"
  - "!**/{.env,.env.*,.npmrc,pnpm-lock.yaml}"
  - "!**/{tsconfig.json,tsconfig.tsbuildinfo,tsconfig.node.json,tsconfig.web.json}"
  - "!**/{.editorconfig,.jekyll-metadata}"
  - "!src"
  - "!config"
  - "!patches"
  - "!app-upgrade-config.json"
  - "!**/node_modules/**/*.cpp"
  - "!**/node_modules/node-addon-api/**"
  - "!**/node_modules/prebuild-install/**"
  - "!scripts"
  - "!local"
  - "!docs"
  - "!packages"
  - "!server"
  - "!.swc"
  - "!.bin"
  - "!._*"
  - "!*.log"
  - "!stats.html"
  - "!*.md"
  - "!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}"
  - "!**/*.{map,ts,tsx,jsx,less,scss,sass,css.d.ts,d.cts,d.mts,md,markdown,yaml,yml}"
  - "!**/{test,tests,__tests__,powered-test,coverage}/**"
  - "!**/{example,examples}/**"
  - "!**/*.{spec,test}.{js,jsx,ts,tsx}"
  - "!**/*.min.*.map"
  - "!**/*.d.ts"
  - "!**/dist/es6/**"
  - "!**/dist/demo/**"
  - "!**/amd/**"
  - "!**/{.DS_Store,Thumbs.db,thumbs.db,__pycache__}"
  - "!**/{LICENSE,license,LICENSE.*,*.LICENSE.txt,NOTICE.txt,README.md,readme.md,CHANGELOG.md}"
  - "!node_modules/rollup-plugin-visualizer"
  - "!node_modules/js-tiktoken"
  - "!node_modules/@tavily/core/node_modules/js-tiktoken"
  - "!node_modules/pdf-parse/lib/pdf.js/{v1.9.426,v1.10.88,v2.0.550}"
  - "!node_modules/mammoth/{mammoth.browser.js,mammoth.browser.min.js}"
  - "!node_modules/selection-hook/prebuilds/**/*"
  - "!node_modules/selection-hook/node_modules"
  - "!node_modules/selection-hook/src"
  - "!node_modules/tesseract.js-core/{tesseract-core.js,tesseract-core.wasm,tesseract-core.wasm.js}"
  - "!node_modules/tesseract.js-core/{tesseract-core-lstm.js,tesseract-core-lstm.wasm,tesseract-core-lstm.wasm.js}"
  - "!node_modules/tesseract.js-core/{tesseract-core-simd-lstm.js,tesseract-core-simd-lstm.wasm,tesseract-core-simd-lstm.wasm.js}"
  - "!**/*.{h,iobj,ipdb,tlog,recipe,vcxproj,vcxproj.filters,Makefile,*.Makefile}"
asarUnpack:
  - resources/**
  - "**/*.{metal,exp,lib}"
  - "node_modules/@img/sharp-libvips-*/**"
win:
  executableName: ${brandConfig.executableName}
  icon: ${iconWin}
  artifactName: \${productName}-\${version}-\${arch}-setup.\${ext}
  target:
    - target: nsis
    - target: portable
  signtoolOptions:
    sign: scripts/win-sign.js
  verifyUpdateCodeSignature: false
nsis:
  artifactName: \${productName}-\${version}-\${arch}-setup.\${ext}
  shortcutName: \${productName}
  uninstallDisplayName: \${productName}
  createDesktopShortcut: always
  allowToChangeInstallationDirectory: true
  oneClick: false
  include: build/nsis-installer.nsh
  buildUniversalInstaller: false
  differentialPackage: false
portable:
  artifactName: \${productName}-\${version}-\${arch}-portable.\${ext}
  buildUniversalInstaller: false
mac:
  icon: ${iconMac}
  entitlementsInherit: build/entitlements.mac.plist
  notarize: false
  artifactName: \${productName}-\${version}-\${arch}.\${ext}
  extendInfo:
    - NSCameraUsageDescription: Application requests access to the device's camera.
    - NSMicrophoneUsageDescription: Application requests access to the device's microphone.
    - NSDocumentsFolderUsageDescription: Application requests access to the user's Documents folder.
    - NSDownloadsFolderUsageDescription: Application requests access to the user's Downloads folder.
  target:
    - target: dmg
    - target: zip
dmg:
  writeUpdateInfo: false
linux:
  icon: ${iconLinux}
  artifactName: \${productName}-\${version}-\${arch}.\${ext}
  executableName: ${brandConfig.executableName}
  target:
    - target: AppImage
    - target: deb
    - target: rpm
  maintainer: electronjs.org
  category: Utility
  desktop:
    entry:
      Name: ${brandConfig.productName}
      StartupWMClass: ${brandConfig.desktopName.replace('.desktop', '')}
rpm:
  fpm: ["--rpm-rpmbuild-define=_build_id_links none"]
publish:
  provider: generic
  url: ${brandConfig.homepage}
electronDownload:
  mirror: https://npmmirror.com/mirrors/electron/
beforePack: scripts/before-pack.js
afterPack: scripts/after-pack.js
afterSign: scripts/notarize.js
artifactBuildCompleted: scripts/artifact-build-completed.js
`
}

// Copy brand assets if they exist
// Note: Icons (icon.png, icon.icns, icon.ico) are NOT copied to build directory
// They are used directly from brand directory via electron-builder config
// Returns an array of copied file paths for later restoration
function copyBrandAssets(brandConfig) {
  const assets = brandConfig.assets
  const rootDir = path.join(__dirname, '..')

  // Check if custom brand assets directory exists
  const brandDir = path.dirname(assets.icon)
  const isCustomBrand = brandDir.startsWith('brand-')

  if (!isCustomBrand) {
    // For default brand, assets are already in build/ directory, no need to copy
    return []
  }

  if (!fs.existsSync(path.join(rootDir, brandDir))) {
    return []
  }

  console.log(`Found custom brand assets in ${brandDir}/`)

  // Skip icon files - they are used directly by electron-builder
  const skipKeys = ['icon', 'iconMac', 'iconWin']
  const copiedFiles = [] // Track copied files for restoration

  // Copy other assets (logo, tray icons, etc.)
  for (const [key, assetPath] of Object.entries(assets)) {
    if (skipKeys.includes(key)) {
      console.log(`  ↗ Using ${key} directly: ${assetPath}`)
      continue
    }

    const sourcePath = path.join(rootDir, assetPath)
    const targetPath = path.join(rootDir, 'build', path.basename(assetPath))

    if (fs.existsSync(sourcePath)) {
      // Backup original file before overwriting
      if (fs.existsSync(targetPath)) {
        const backupPath = targetPath + '.brand-backup'
        fs.copyFileSync(targetPath, backupPath)
        copiedFiles.push({ target: targetPath, backup: backupPath })
      }
      fs.copyFileSync(sourcePath, targetPath)
      console.log(`  ✓ Copied ${key}: ${assetPath}`)
    } else {
      console.log(`  ⚠ Skipped ${key}: ${assetPath} (not found)`)
    }
  }

  return copiedFiles
}

// Restore build/ assets from backups after custom brand build
function restoreBuildAssets(copiedFiles) {
  if (!copiedFiles || copiedFiles.length === 0) {
    return
  }

  console.log('\nRestoring build/ assets to default...')

  for (const { target, backup } of copiedFiles) {
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, target)
      fs.unlinkSync(backup)
      console.log(`  ✓ Restored ${path.basename(target)}`)
    }
  }

  console.log('Build/ assets restored to default\n')
}

// Export environment variables for use in build scripts
function exportEnvVars(envVars) {
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${typeof value === 'boolean' ? (value ? 'true' : 'false') : value}`)
    .join('\n')

  console.log('\n=== Build Environment Variables ===')
  console.log(envContent)
  console.log('=====================================\n')

  // Write to .env.brand file for use with dotenv-cli
  const envPath = path.join(__dirname, '..', '.env.brand')
  fs.writeFileSync(envPath, envContent)
  console.log(`Environment variables written to ${envPath}`)
  console.log('Use with: dotenv -e .env.brand -- <command>\n')
}

// Write a temporary build-constants file with brand values hardcoded
// This ensures brand constants are baked into the bundled code
function writeTempBuildConstants(envVars, profile) {
  const constantsPath = path.join(__dirname, '..', 'packages', 'shared', 'build-constants.ts')
  const backupPath = constantsPath + '.backup'

  // Read original file
  const originalContent = fs.readFileSync(constantsPath, 'utf8')

  // Backup original file
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, originalContent)
  }

  // Generate hardcoded version
  const hardcodedContent = `/**
 * BUILD-TIME BRAND CONSTANTS - Auto-generated for brand: ${profile}
 * This file is temporarily modified during brand builds
 * Original file backed up as build-constants.ts.backup
 */

export const BUILD_CONSTANTS = {
  ENABLE_TEST_PLAN: ${envVars.ENABLE_TEST_PLAN === 'true'},
  APP_NAME: '${envVars.APP_NAME}',
  APP_DESCRIPTION: '${envVars.APP_DESCRIPTION.replace(/'/g, "\\'")}',
  APP_ID: '${envVars.APP_ID}',
  APP_AUTHOR: '${envVars.APP_AUTHOR}',
  APP_HOMEPAGE: '${envVars.APP_HOMEPAGE}',
  APP_PROTOCOL: '${envVars.APP_PROTOCOL}',
  IS_CUSTOM_BUILD: ${envVars.CUSTOM_BUILD === 'true'},
  BUILD_BRAND: '${envVars.BUILD_BRAND}',
  // AGPL-3.0 Compliance: These fields must be preserved for license compliance
  ORIGINAL_PROJECT_NAME: 'Cherry Studio',
  ORIGINAL_PROJECT_URL: 'https://github.com/CherryHQ/cherry-studio',
  ORIGINAL_PROJECT_LICENSE: 'AGPL-3.0',
  LICENSE_URL: 'https://www.gnu.org/licenses/agpl-3.0.html',
  SOURCE_CODE_URL: '${envVars.SOURCE_CODE_URL}',
  // Contact and feature visibility
  CONTACT_EMAIL: '${envVars.CONTACT_EMAIL}',
  SHOW_DOCS: ${envVars.SHOW_DOCS === 'true'},
  SHOW_WEBSITE: ${envVars.SHOW_WEBSITE === 'true'},
  SHOW_ENTERPRISE: ${envVars.SHOW_ENTERPRISE === 'true'},
  SHOW_CAREERS: ${envVars.SHOW_CAREERS === 'true'},
  GITHUB_REPO_URL: '${envVars.GITHUB_REPO_URL}',
  // Update server configuration
  UPDATE_SERVER_URL: '${envVars.UPDATE_SERVER_URL}',
  UPDATE_CONFIG_URL: '${envVars.UPDATE_CONFIG_URL}',
  UPDATE_FEED_URL: '${envVars.UPDATE_FEED_URL}',
  UPDATE_MIRROR: '${envVars.UPDATE_MIRROR}'
} as const

export type BuildConstants = typeof BUILD_CONSTANTS
`

  fs.writeFileSync(constantsPath, hardcodedContent)
  console.log(`  ✓ Wrote brand constants to build-constants.ts`)

  return backupPath
}

// Restore original build-constants file
function restoreBuildConstants(backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) {
    return
  }
  const constantsPath = path.join(__dirname, '..', 'packages', 'shared', 'build-constants.ts')
  fs.copyFileSync(backupPath, constantsPath)
  fs.unlinkSync(backupPath)
  console.log(`  ✓ Restored original build-constants.ts`)
}

// Write electron-builder.yml for brand build
function writeElectronBuilderConfig(brandConfig, profile) {
  if (profile === 'default') {
    console.log('Skipping electron-builder.yml generation for default profile')
    return
  }

  const yamlConfig = generateElectronBuilderConfig(brandConfig)
  const configPath = path.join(__dirname, '..', 'electron-builder.brand.yml')
  fs.writeFileSync(configPath, yamlConfig)
  console.log(`Brand electron-builder config written to ${configPath}`)
}

// Run build with environment variables set
function runBuild(envVars, copiedFiles) {
  const { execSync } = require('child_process')

  console.log('\n🔨 Starting build with brand configuration...\n')

  let backupPath = null

  try {
    // Write brand constants to build-constants.ts
    backupPath = writeTempBuildConstants(envVars, envVars.BUILD_BRAND)

    // Run typecheck
    console.log('Running: npm run typecheck')
    execSync('npm run typecheck', {
      stdio: 'inherit',
      env: { ...process.env }
    })

    // Run build
    console.log('Running: electron-vite build')
    execSync('npx electron-vite build', {
      stdio: 'inherit',
      env: { ...process.env }
    })

    // Copy brand logo to renderer assets (without hash)
    const logoSource = path.join(__dirname, '..', 'build', 'logo.png')
    const logoTarget = path.join(__dirname, '..', 'out', 'renderer', 'assets', 'logo.png')
    if (fs.existsSync(logoSource)) {
      fs.copyFileSync(logoSource, logoTarget)
      console.log('  ✓ Copied brand logo to renderer assets')
    }

    console.log('\n✅ Build complete!')

    // Restore build/ assets for custom brands
    restoreBuildAssets(copiedFiles)

    return { success: true, backupPath }
  } catch (error) {
    console.error('\n❌ Build failed:', error.message)
    // Restore on failure
    if (backupPath) {
      restoreBuildConstants(backupPath)
    }
    restoreBuildAssets(copiedFiles)
    return { success: false, backupPath: null }
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2)
  const profile = args.find((arg) => !arg.startsWith('--')) || 'default'
  const shouldBuild = args.includes('--build')

  console.log(`🎨 Brand Builder: Configuring build for profile "${profile}"`)

  // Load and validate configuration
  const config = loadBrandConfig()
  const brandConfig = validateBrandProfile(config, profile)

  // Generate environment variables
  const envVars = generateEnvVars(brandConfig, profile)

  // Copy brand assets if available (returns list of copied files for restoration)
  const copiedFiles = copyBrandAssets(brandConfig)

  // Export environment variables (sets process.env)
  exportEnvVars(envVars)

  // Write electron-builder.yml for brand builds
  writeElectronBuilderConfig(brandConfig, profile)

  console.log('✅ Brand configuration complete!')

  if (shouldBuild) {
    const result = runBuild(envVars, copiedFiles)

    // Restore build-constants.ts after build
    if (result.backupPath) {
      restoreBuildConstants(result.backupPath)
    }

    if (!result.success) {
      process.exit(1)
    }
  } else {
    console.log(`\nTo build with this configuration, use:`)
    console.log(`  node scripts/brand-builder.js ${profile} --build`)
    console.log(`  or`)
    console.log(`  dotenv -e .env.brand -- pnpm build`)
  }
}

// Run if executed directly
if (require.main === module) {
  main()
}

module.exports = { loadBrandConfig, validateBrandProfile, generateEnvVars }
