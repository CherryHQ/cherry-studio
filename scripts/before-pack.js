const { Arch } = require('electron-builder')

exports.default = async function (context) {
  const platform = context.packager.platform.name
  const arch = context.arch
  let filters = context.packager.config.files[0].filter

  if (platform === 'mac') {
    if (arch === Arch.arm64) {
      filters.push(
        '!node_modules/@img/sharp-darwin-x64',
        '!node_modules/@img/sharp-libvips-darwin-x64',
        '!node_modules/@napi-rs/system-ocr-darwin-x64',
        '!node_modules/@libsql/darwin-x64'
      )
    } else {
      filters.push(
        '!node_modules/@img/sharp-darwin-arm64',
        '!node_modules/@img/sharp-libvips-darwin-arm64',
        '!node_modules/@napi-rs/system-ocr-darwin-arm64',
        '!node_modules/@libsql/darwin-arm64'
      )
    }
  }

  if (platform === 'linux') {
    if (arch === Arch.arm64) {
      filters.push(
        '!node_modules/@img/sharp-libvips-linux-x64',
        '!node_modules/@img/sharp-linux-x64',
        '!node_modules/@libsql/linux-x64-gnu',
        '!node_modules/@libsql/linux-x64-musl'
      )
    } else {
      filters.push(
        '!node_modules/@img/sharp-libvips-linux-arm64',
        '!node_modules/@img/sharp-linux-arm64',
        '!node_modules/@libsql/linux-arm64-gnu',
        '!node_modules/@libsql/linux-arm64-musl'
      )
    }
  }

  if (platform === 'windows') {
    if (arch === Arch.arm64) {
      filters.push(
        '!node_modules/@img/sharp-win32-arm64',
        '!node_modules/@img/sharp-libvips-win32-arm64',
        '!node_modules/@libsql/win32-arm64-msvc',
        '!node_modules/@strongtz/win32-arm64-msvc'
      )
    } else {
      filters.push(
        '!node_modules/@img/sharp-win32-x64',
        '!node_modules/@img/sharp-libvips-win32-x64',
        '!node_modules/@libsql/win32-x64-msvc'
      )
    }
  }
}
