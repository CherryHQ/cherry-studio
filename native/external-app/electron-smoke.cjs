const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { smoke } = require('./smoke.cjs')

const [, , fixture, handler] = process.argv.filter((argument) => !argument.startsWith('--'))
app.setPath('userData', path.join(path.dirname(fixture), 'electron-profile'))
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({ show: false })
    try {
      await smoke(fixture, handler)
    } finally {
      window.destroy()
    }
  })
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`)
    process.exitCode = 1
  })
  .finally(() => app.exit(process.exitCode ?? 0))
