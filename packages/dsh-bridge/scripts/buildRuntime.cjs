const path = require('node:path')

const { buildDshRuntimePackage } = require('./runtimeBuilder.cjs')

function readOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index !== -1) return process.argv[index + 1]
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : fallback
}

const packageRoot = path.join(__dirname, '..')
const projectRoot = path.join(packageRoot, '..', '..')
const platform = readOption('platform', process.platform)
const arch = readOption('arch', process.arch)

buildDshRuntimePackage({ projectRoot, packageRoot, platform, arch })
  .then(({ artifact }) => {
    process.stdout.write(`Built DSH runtime ${platform}-${arch} (${artifact.version})\n`)
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exitCode = 1
  })
