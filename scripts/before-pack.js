const { Arch } = require('electron-builder')
const { downloadNpmPackage } = require('./utils')

exports.default = async function (context) {
  const arch = context.arch
  const platform = context.packager.platform.name
  let filters = context.packager.config.files[0].filter

  const platformToArch = {
    mac: 'darwin',
    windows: 'win32',
    linux: 'linux'
  }

  const allArm64 = {
    '@img/sharp-darwin-arm64': '0.34.3',
    '@img/sharp-win32-arm64': '0.34.3',
    '@img/sharp-linux-arm64': '0.34.3',
    '@img/sharp-linuxmusl-arm64': '0.34.3',

    '@img/sharp-libvips-darwin-arm64': '1.2.0',
    '@img/sharp-libvips-linux-arm64': '1.2.0',
    '@img/sharp-libvips-linuxmusl-arm64': '1.2.0',

    '@libsql/darwin-arm64': '0.4.7',
    '@libsql/linux-arm64-gnu': '0.4.7',
    '@libsql/linux-arm64-musl': '0.4.7',
    '@strongtz/win32-arm64-msvc': '0.4.7',

    '@napi-rs/system-ocr-darwin-arm64': '1.0.2',
    '@napi-rs/system-ocr-win32-arm64-msvc': '1.0.2'
  }

  const allX64 = {
    '@img/sharp-darwin-x64': '0.34.3',
    '@img/sharp-linux-x64': '0.34.3',
    '@img/sharp-linuxmusl-x64': '0.34.3',
    '@img/sharp-win32-x64': '0.34.3',

    '@img/sharp-libvips-darwin-x64': '1.2.0',
    '@img/sharp-libvips-linux-x64': '1.2.0',
    '@img/sharp-libvips-linuxmusl-x64': '1.2.0',

    '@libsql/darwin-x64': '0.4.7',
    '@libsql/linux-x64-gnu': '0.4.7',
    '@libsql/linux-x64-musl': '0.4.7',
    '@libsql/win32-x64-msvc': '0.4.7',

    '@napi-rs/system-ocr-darwin-x64': '1.0.2',
    '@napi-rs/system-ocr-win32-x64-msvc': '1.0.2'
  }

  const arm64Filters = Object.keys(allArm64).map((f) => '!node_modules/' + f)
  const x64Filters = Object.keys(allX64).map((f) => '!node_modules/' + f)

  const downloadPackages = (packages) => {
    Object.keys(packages).forEach((name) => {
      if (name.includes(`${platformToArch[platform]}` && name.includes(`-${arch}`))) {
        // https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-0.34.3.tgz'
        https: downloadNpmPackage(
          name,
          `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${packages[name]}.tgz`
        )
      }
    })
  }

  const changeFilters = (archs, addFilters, deleteFilters) => {
    console.log('downloading all ' + arch + ' packages...')
    downloadPackages(archs)

    // remove all x64 filters

    filters = filters.filter((filter) => !deleteFilters.includes(filter))
    filters.push(...addFilters)
  }

  if (arch === Arch.arm64) {
    changeFilters(allArm64, arm64Filters, x64Filters)
  } else {
    changeFilters(allX64, x64Filters, arm64Filters)
  }
}
