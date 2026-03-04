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
function copyBrandAssets(brandConfig) {
  const assets = brandConfig.assets
  const rootDir = path.join(__dirname, '..')

  // Check if custom brand assets directory exists
  const brandDir = path.dirname(assets.icon)
  if (fs.existsSync(path.join(rootDir, brandDir)) && brandDir.startsWith('brand-')) {
    console.log(`Found custom brand assets in ${brandDir}/`)

    // Copy each asset if it exists
    for (const [key, assetPath] of Object.entries(assets)) {
      const sourcePath = path.join(rootDir, assetPath)
      const targetPath = path.join(rootDir, 'build', path.basename(assetPath))

      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath)
        console.log(`  ✓ Copied ${key}: ${assetPath}`)
      } else {
        console.log(`  ⚠ Skipped ${key}: ${assetPath} (not found)`)
      }
    }
  }
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

// Main execution
function main() {
  const args = process.argv.slice(2)
  const profile = args[0] || 'default'

  console.log(`🎨 Brand Builder: Configuring build for profile "${profile}"`)

  // Load and validate configuration
  const config = loadBrandConfig()
  const brandConfig = validateBrandProfile(config, profile)

  // Generate environment variables
  const envVars = generateEnvVars(brandConfig, profile)

  // Copy brand assets if available
  copyBrandAssets(brandConfig)

  // Export environment variables
  exportEnvVars(envVars)

  // Write electron-builder.yml for brand builds
  writeElectronBuilderConfig(brandConfig, profile)

  console.log('✅ Brand configuration complete!')
  console.log(`\nTo build with this configuration, use:`)
  console.log(`  dotenv -e .env.brand -- pnpm build`)
  console.log(`  or`)
  console.log(`  BRAND_PROFILE=${profile} pnpm build`)
}

// Run if executed directly
if (require.main === module) {
  main()
}

module.exports = { loadBrandConfig, validateBrandProfile, generateEnvVars }
