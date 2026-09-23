const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const pins = JSON.parse(fs.readFileSync(path.join(root, 'build/integration-sources.json')))
const service = process.env.SERVICE
if (!['surreal-memory', 'liter-llm'].includes(service)) throw new Error('Unknown service')
const checkout = (name, directory) => {
  const pin = pins.sources[name]
  fs.mkdirSync(directory, { recursive: true })
  for (const args of [['init'], ['fetch', '--depth=1', `https://github.com/${pin.repository}.git`, pin.revision], ['checkout', '--detach', 'FETCH_HEAD']]) {
    execFileSync('git', args, { cwd: directory, stdio: 'inherit' })
  }
}
const source = path.join(root, 'build/service-source')
checkout(service, source)
if (service === 'surreal-memory') fs.copyFileSync(path.join(source, 'Dockerfile'), path.join(source, 'Dockerfile.boss'))
else {
  const mini = path.join(root, 'build/mini-source')
  checkout('mini', mini)
  fs.copyFileSync(path.join(mini, 'docker/liter-llm.Dockerfile'), path.join(source, 'Dockerfile.boss'))
}
