const { Arch } = require('electron-builder')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const workspaceConfigPath = path.join(__dirname, '..', 'pnpm-workspace.yaml')

// if you want to add new prebuild binaries packages with different architectures, you can add them here
// please add to allX64 and allArm64 from pnpm-lock.yaml
const packages = [
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-libvips-darwin-arm64',
  '@img/sharp-libvips-darwin-x64',
  '@img/sharp-libvips-linux-arm64',
  '@img/sharp-libvips-linuxmusl-arm64',
  '@img/sharp-libvips-linux-x64',
  '@img/sharp-libvips-linuxmusl-x64',
  '@img/sharp-linux-arm64',
  '@img/sharp-linux-x64',
  '@img/sharp-linuxmusl-arm64',
  '@img/sharp-linuxmusl-x64',
  '@img/sharp-win32-arm64',
  '@img/sharp-win32-x64',
  '@libsql/darwin-arm64',
  '@libsql/darwin-x64',
  '@libsql/linux-arm64-gnu',
  '@libsql/linux-x64-gnu',
  '@libsql/linux-arm64-musl',
  '@libsql/linux-x64-musl',
  '@libsql/win32-x64-msvc',
  '@napi-rs/system-ocr-darwin-arm64',
  '@napi-rs/system-ocr-darwin-x64',
  '@napi-rs/system-ocr-win32-arm64-msvc',
  '@napi-rs/system-ocr-win32-x64-msvc',
  '@strongtz/win32-arm64-msvc'
]

const platformToArch = {
  mac: 'darwin',
  windows: 'win32',
  linux: 'linux',
  linuxmusl: 'linuxmusl'
}

exports.default = async function (context) {
  const arch = context.arch === Arch.arm64 ? 'arm64' : 'x64'
  const platformName = context.packager.platform.name
  const platform = platformToArch[platformName]

  const downloadPackages = async () => {
    // Skip if target platform and architecture match current system
    if (platform === process.platform && arch === process.arch) {
      console.log(`Skipping install: target (${platform}/${arch}) matches current system`)
      return
    }

    console.log(`Installing packages for target platform=${platform} arch=${arch}...`)

    // Backup and modify pnpm-workspace.yaml to add target platform support
    const originalWorkspaceConfig = fs.readFileSync(workspaceConfigPath, 'utf-8')
    const workspaceConfig = yaml.load(originalWorkspaceConfig)

    // Add target platform to supportedArchitectures.os
    if (!workspaceConfig.supportedArchitectures.os.includes(platform)) {
      workspaceConfig.supportedArchitectures.os.push(platform)
    }

    // Add target architecture to supportedArchitectures.cpu
    if (!workspaceConfig.supportedArchitectures.cpu.includes(arch)) {
      workspaceConfig.supportedArchitectures.cpu.push(arch)
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

  await downloadPackages()

  const excludePackages = async (packagesToExclude) => {
    // 从项目根目录的 electron-builder.yml 读取 files 配置，避免多次覆盖配置导致出错
    const electronBuilderConfigPath = path.join(__dirname, '..', 'electron-builder.yml')
    const electronBuilderConfig = yaml.load(fs.readFileSync(electronBuilderConfigPath, 'utf-8'))
    let filters = electronBuilderConfig.files

    // add filters for other architectures (exclude them)
    filters.push(...packagesToExclude)

    context.packager.config.files[0].filter = filters
  }

  const arm64KeepPackages = packages.filter((p) => p.includes('arm64') && p.includes(platform))
  const arm64ExcludePackages = packages
    .filter((p) => !arm64KeepPackages.includes(p))
    .map((p) => '!node_modules/' + p + '/**')

  const x64KeepPackages = packages.filter((p) => p.includes('x64') && p.includes(platform))
  const x64ExcludePackages = packages
    .filter((p) => !x64KeepPackages.includes(p))
    .map((p) => '!node_modules/' + p + '/**')

  const excludeRipgrepFilters = ['arm64-darwin', 'arm64-linux', 'x64-darwin', 'x64-linux', 'x64-win32']
    .filter((f) => {
      // On Windows ARM64, also keep x64-win32 for emulation compatibility
      if (platform === 'win32' && context.arch === Arch.arm64 && f === 'x64-win32') {
        return false
      }
      return f !== `${arch}-${platform}`
    })
    .map((f) => '!node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/' + f + '/**')

  if (context.arch === Arch.arm64) {
    await excludePackages([...arm64ExcludePackages, ...excludeRipgrepFilters])
  } else {
    await excludePackages([...x64ExcludePackages, ...excludeRipgrepFilters])
  }
}
