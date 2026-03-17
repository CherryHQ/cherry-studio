const Module = require('module')
const path = require('path')

const aliases = {
  '@shared/': path.resolve(__dirname, '../packages/shared/'),
  '@cherrystudio/provider-catalog': path.resolve(__dirname, '../packages/provider-catalog/src/index.ts')
}

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  for (const [alias, target] of Object.entries(aliases)) {
    if (request === alias || request.startsWith(alias)) {
      request = request.replace(alias, alias.endsWith('/') ? target + '/' : target)
      break
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}
