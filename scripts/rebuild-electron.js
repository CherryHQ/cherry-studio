const { rebuild } = require('@electron/rebuild')
const path = require('node:path')

rebuild({
  buildPath: path.join(__dirname, '..'),
  electronVersion: require('electron/package.json').version,
  onlyModules: process.platform === 'linux' ? ['better-sqlite3'] : ['better-sqlite3', '@vscode/fs-copyfile'],
  force: true
}).catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
