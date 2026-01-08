const { Arch } = require('electron-builder')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const workspaceConfigPath = path.join(__dirname, '..', 'pnpm-workspace.yaml')

// if you want to add new prebuild binaries packages with different architectures, you can add them here
// please add to allX64 and allArm64 from pnpm-lock.yaml
const allArm64 = {
  '@img/sharp-darwin-arm64': '0.34.3',
  '@img/sharp-win32-arm64': '0.34.3',
  '@img/sharp-linux-arm64': '0.34.3',

  '@img/sharp-libvips-darwin-arm64': '1.2.4',
  '@img/sharp-libvips-linux-arm64': '1.2.4',

  '@libsql/darwin-arm64': '0.4.7',
  '@libsql/linux-arm64-gnu': '0.4.7',
  '@strongtz/win32-arm64-msvc': '0.4.7',

  '@napi-rs/system-ocr-darwin-arm64': '1.0.2',
  '@napi-rs/system-ocr-win32-arm64-msvc': '1.0.2'
}

const allX64 = {
  '@img/sharp-darwin-x64': '0.34.3',
  '@img/sharp-linux-x64': '0.34.3',
  '@img/sharp-win32-x64': '0.34.3',

  '@img/sharp-libvips-darwin-x64': '1.2.4',
  '@img/sharp-libvips-linux-x64': '1.2.4',

  '@libsql/darwin-x64': '0.4.7',
  '@libsql/linux-x64-gnu': '0.4.7',
  '@libsql/win32-x64-msvc': '0.4.7',

  '@napi-rs/system-ocr-darwin-x64': '1.0.2',
  '@napi-rs/system-ocr-win32-x64-msvc': '1.0.2'
}

const claudeCodeVenderPath = '@anthropic-ai/claude-agent-sdk/vendor'
const claudeCodeVenders = ['arm64-darwin', 'arm64-linux', 'x64-darwin', 'x64-linux', 'x64-win32']

const platformToArch = {
  mac: 'darwin',
  windows: 'win32',
  linux: 'linux'
}

exports.default = async function (context) {
  const arch = context.arch
  const archType = arch === Arch.arm64 ? 'arm64' : 'x64'
  const platform = context.packager.platform.name

  const downloadPackages = async () => {
    const targetPlatform = platformToArch[platform]

    // Skip if target platform and architecture match current system
    if (targetPlatform === process.platform && archType === process.arch) {
      console.log(`Skipping install: target (${targetPlatform}/${archType}) matches current system`)
      return
    }

    console.log(`Installing packages for target platform=${targetPlatform} arch=${archType}...`)

    // Backup and modify pnpm-workspace.yaml to add target platform support
    const originalWorkspaceConfig = fs.readFileSync(workspaceConfigPath, 'utf-8')
    const workspaceConfig = yaml.load(originalWorkspaceConfig)

    // Add target platform to supportedArchitectures.os
    if (!workspaceConfig.supportedArchitectures.os.includes(targetPlatform)) {
      workspaceConfig.supportedArchitectures.os.push(targetPlatform)
    }

    // Add target architecture to supportedArchitectures.cpu
    if (!workspaceConfig.supportedArchitectures.cpu.includes(archType)) {
      workspaceConfig.supportedArchitectures.cpu.push(archType)
    }

    const modifiedWorkspaceConfig = yaml.dump(workspaceConfig)
    console.log('Modified workspace config:', modifiedWorkspaceConfig)
    fs.writeFileSync(workspaceConfigPath, modifiedWorkspaceConfig)

    try {
      execSync(`pnpm install`, { stdio: 'inherit' })
    } finally {
      // Restore original pnpm-workspace.yaml
      fs.writeFileSync(workspaceConfigPath, originalWorkspaceConfig)
    }
  }

  const changeFilters = async (filtersToExclude, filtersToInclude) => {
    // remove filters for the target architecture (allow inclusion)
    let filters = context.packager.config.files[0].filter
    filters = filters.filter((filter) => !filtersToInclude.includes(filter))

    // add filters for other architectures (exclude them)
    filters.push(...filtersToExclude)

    context.packager.config.files[0].filter = filters
  }

  await downloadPackages()

  const arm64Filters = Object.keys(allArm64).map((f) => '!node_modules/' + f + '/**')
  const x64Filters = Object.keys(allX64).map((f) => '!node_modules/' + f + '/*')

  // Determine which claudeCodeVenders to include
  // For Windows ARM64, also include x64-win32 for compatibility
  const includedClaudeCodeVenders = [`${archType}-${platformToArch[platform]}`]
  if (platform === 'windows' && arch === Arch.arm64) {
    includedClaudeCodeVenders.push('x64-win32')
  }

  const excludeClaudeCodeRipgrepFilters = claudeCodeVenders
    .filter((f) => !includedClaudeCodeVenders.includes(f))
    .map((f) => '!node_modules/' + claudeCodeVenderPath + '/ripgrep/' + f + '/**')

  const includeClaudeCodeFilters = includedClaudeCodeVenders.map(
    (f) => '!node_modules/' + claudeCodeVenderPath + '/ripgrep/' + f + '/**'
  )

  if (arch === Arch.arm64) {
    await changeFilters(
      [...x64Filters, ...excludeClaudeCodeRipgrepFilters],
      [...arm64Filters, ...includeClaudeCodeFilters]
    )
  } else {
    await changeFilters(
      [...arm64Filters, ...excludeClaudeCodeRipgrepFilters],
      [...x64Filters, ...includeClaudeCodeFilters]
    )
  }
}
