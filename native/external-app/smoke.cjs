const assert = require('node:assert/strict')
const path = require('node:path')

async function smoke(fileArgument = 'README.md', applicationId) {
  const addonPath = path.resolve(
    __dirname,
    '../../resources/binaries',
    `${process.platform}-${process.arch}`,
    'external-app.node'
  )
  const addon = require(addonPath)
  const file = path.resolve(fileArgument)
  const result = await addon.list(file)
  assert(Array.isArray(result.applications))
  assert(result.applications.length > 0, 'The fixture must have at least one registered handler')
  assert.equal(new Set(result.applications.map((app) => app.id)).size, result.applications.length)
  for (const app of result.applications) {
    assert.equal(typeof app.id, 'string')
    assert(app.id.length > 0)
    assert.equal(typeof app.name, 'string')
    assert(app.name.length > 0)
  }
  if (process.platform === 'darwin') {
    for (const app of result.applications) {
      assert(app.iconDataUrl?.startsWith('data:image/png;base64,'), `Missing application icon: ${app.name}`)
      const png = Buffer.from(app.iconDataUrl.split(',')[1], 'base64')
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert.equal(png.readUInt32BE(16), 32)
      assert.equal(png.readUInt32BE(20), 32)
    }
    if (result.applications.length > 1) {
      assert(new Set(result.applications.map((app) => app.iconDataUrl)).size > 1, 'All handlers have the same icon')
    }
  }
  assert.throws(() => addon.list('relative-path'), /absolute/)
  assert.throws(() => addon.list(`${file}\0.txt`), /absolute/)
  await assert.rejects(addon.open(file, 'cherry-smoke-nonexistent-handler'), /associated/)
  if (applicationId) {
    assert(
      result.applications.some((app) => app.id === applicationId),
      'Requested handler is not registered'
    )
    await addon.open(file, applicationId)
  }
  process.stdout.write(
    `${JSON.stringify({ file, count: result.applications.length, defaultApplication: result.defaultApplication, applications: result.applications, opened: applicationId ?? null }, null, 2)}\n`
  )
}
module.exports = { smoke }
if (require.main === module)
  smoke(process.argv[2], process.argv[3]).catch((error) => {
    process.stderr.write(`${error.stack}\n`)
    process.exitCode = 1
  })
