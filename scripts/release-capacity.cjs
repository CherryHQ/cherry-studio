const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const reportOnly = process.argv.includes('--report-only')
const minimumFreeBytes = 10 * 1024 ** 3

function directorySize(directory) {
  if (!fs.existsSync(directory)) return 0
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size
  }
  return total
}

const filesystem = fs.statfsSync(root)
const freeBytes = filesystem.bavail * filesystem.bsize
const details = {
  freeDiskGiB: Number((freeBytes / 1024 ** 3).toFixed(2)),
  freeMemoryGiB: Number((os.freemem() / 1024 ** 3).toFixed(2)),
  totalMemoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
  payloadGiB: Number((directorySize(path.join(root, 'build', 'prometheus-payload')) / 1024 ** 3).toFixed(2)),
  distGiB: Number((directorySize(path.join(root, 'dist')) / 1024 ** 3).toFixed(2))
}

console.log(`Release capacity: ${JSON.stringify(details)}`)
if (!reportOnly && freeBytes < minimumFreeBytes) {
  console.error(`At least 10 GiB of free disk is required; found ${details.freeDiskGiB} GiB`)
  process.exitCode = 1
}
