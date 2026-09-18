const { app, BrowserWindow, ipcMain } = require('electron')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}`)
  return path.resolve(process.argv[index + 1])
}

const sourceWavPath = argument('--source-wav')
const webmPath = argument('--webm')
const derivedWavPath = argument('--wav')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let settled = false

function finish(exitCode, output) {
  if (settled) return
  settled = true
  const stream = exitCode === 0 ? process.stdout : process.stderr
  stream.write(`${JSON.stringify(output)}\n`)
  app.exit(exitCode)
}

ipcMain.handle('system-speech-validation:source-wav', async () => {
  const { readFile } = require('node:fs/promises')
  return new Uint8Array(await readFile(sourceWavPath))
})

ipcMain.once('system-speech-validation:complete', async (_event, result) => {
  try {
    await Promise.all([writeFile(webmPath, result.webm), writeFile(derivedWavPath, result.wav)])
    finish(0, result.metadata)
  } catch (error) {
    finish(1, { error: error instanceof Error ? error.message : String(error) })
  }
})

ipcMain.once('system-speech-validation:failed', (_event, message) => {
  finish(message === 'unsupported_recording_format' ? 2 : 1, { error: String(message).slice(0, 4096) })
})

setTimeout(() => finish(1, { error: 'electron_validation_timeout' }), 30_000).unref()

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true
      }
    })
    await window.loadFile(path.join(__dirname, 'dist', 'index.html'))
  })
  .catch((error) => {
    finish(1, { error: error instanceof Error ? error.message : String(error) })
  })
