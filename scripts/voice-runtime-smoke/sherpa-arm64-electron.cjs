const { app, utilityProcess } = require('electron')
const path = require('node:path')

app
  .whenReady()
  .then(() => {
    const child = utilityProcess.fork(path.join(__dirname, 'sherpa-arm64-smoke.cjs'), [], { stdio: 'pipe' })
    child.stdout.on('data', (data) => process.stdout.write(data))
    child.stderr.on('data', (data) => process.stderr.write(data))
    child.once('exit', (code) => app.exit(code === 0 ? 0 : 1))
    setTimeout(() => {
      child.kill()
      app.exit(1)
    }, 180_000).unref()
  })
  .catch((error) => {
    process.stderr.write(error.stack + '\n')
    app.exit(1)
  })
