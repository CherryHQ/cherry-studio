const { Arch } = require('electron-builder')

exports.default = async function (context) {
  const arch = context.arch
  let filters = context.packager.config.files[0].filter

  const allArm64 = [
    '!node_modules/@img/sharp-darwin-arm64',
    '!node_modules/@img/sharp-linux-arm64',
    '!node_modules/@img/sharp-win32-arm64',

    '!node_modules/@img/sharp-libvips-darwin-arm64',
    '!node_modules/@img/sharp-libvips-linux-arm64',
    '!node_modules/@img/sharp-libvips-win32-arm64',

    '!node_modules/@napi-rs/system-ocr-darwin-arm64',
    '!node_modules/@napi-rs/system-ocr-win32-arm64',

    '!node_modules/@libsql/darwin-arm64',
    '!node_modules/@libsql/linux-arm64-gnu',
    '!node_modules/@libsql/linux-arm64-musl',
    '!node_modules/@napi-rs/system-ocr-linux-arm64'
  ]

  const allX64 = [
    '!node_modules/@img/sharp-darwin-x64',
    '!node_modules/@img/sharp-win32-x64',
    '!node_modules/@img/sharp-linux-x64',

    '!node_modules/@img/sharp-libvips-darwin-x64',
    '!node_modules/@img/sharp-libvips-win32-x64',
    '!node_modules/@img/sharp-libvips-linux-x64',

    '!node_modules/@napi-rs/system-ocr-darwin-x64',
    '!node_modules/@napi-rs/system-ocr-win32-x64',

    '!node_modules/@libsql/darwin-x64',
    '!node_modules/@libsql/win32-x64-msvc',
    '!node_modules/@libsql/linux-x64-gnu',
    '!node_modules/@libsql/linux-x64-musl'
  ]

  if (arch === Arch.arm64) {
    // remove all x64 filters
    filters = filters.filter((filter) => !allX64.includes(filter))
    filters.push(...allArm64)
  } else {
    // remove all arm64 filters
    filters = filters.filter((filter) => !allArm64.includes(filter))
    filters.push(...allX64)
  }
}
