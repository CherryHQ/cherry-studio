const { Arch } = require('electron-builder')
const { downloadNpmPackage } = require('./utils')

// if you want to add new prebuild binaries packages with different architectures, you can add them here
// please add to allX64 and allArm64 from yarn.lock
const allArm64 = {
  '@img/sharp-darwin-arm64': '0.34.3',
  '@img/sharp-win32-arm64': '0.34.3',
  '@img/sharp-linux-arm64': '0.34.3',

  '@img/sharp-libvips-darwin-arm64': '1.2.0',
  '@img/sharp-libvips-linux-arm64': '1.2.0',

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

  '@img/sharp-libvips-darwin-x64': '1.2.0',
  '@img/sharp-libvips-linux-x64': '1.2.0',

  '@libsql/darwin-x64': '0.4.7',
  '@libsql/linux-x64-gnu': '0.4.7',
  '@libsql/win32-x64-msvc': '0.4.7',

  '@napi-rs/system-ocr-darwin-x64': '1.0.2',
  '@napi-rs/system-ocr-win32-x64-msvc': '1.0.2'
}

const platformToArch = {
  mac: 'darwin',
  windows: 'win32',
  linux: 'linux'
}

exports.default = async function (context) {
  const arch = context.arch
  const archType = arch === Arch.arm64 ? 'arm64' : 'x64'
  const platform = context.packager.platform.name

  const arm64Filters = Object.keys(allArm64).map((f) => '!node_modules/' + f + '/**')
  const x64Filters = Object.keys(allX64).map((f) => '!node_modules/' + f + '/*')

  const downloadPackages = async (packages) => {
    console.log('downloading packages ......')
    const downloadPromises = []

    for (const name of Object.keys(packages)) {
      if (name.includes(`${platformToArch[platform]}`) && name.includes(`-${archType}`)) {
        downloadPromises.push(
          downloadNpmPackage(
            name,
            `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${packages[name]}.tgz`
          )
        )
      }
    }

    await Promise.all(downloadPromises)
  }

  const changeFilters = async (packages, filtersToExclude, filtersToInclude) => {
    await downloadPackages(packages)
    // remove filters for the target architecture (allow inclusion)

    let filters = context.packager.config.files[0].filter
    filters = filters.filter((filter) => !filtersToInclude.includes(filter))
    // add filters for other architectures (exclude them)
    filters.push(...filtersToExclude)

    context.packager.config.files[0].filter = filters
  }

  if (arch === Arch.arm64) {
    await changeFilters(allArm64, x64Filters, arm64Filters)
    return
  }

  if (arch === Arch.x64) {
    await changeFilters(allX64, arm64Filters, x64Filters)
    return
  }
}
