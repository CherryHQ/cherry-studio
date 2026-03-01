// Clear ELECTRON_RUN_AS_NODE which VS Code-based editors (VS Code, Antigravity, Cursor, etc.)
// set in their integrated terminals. This variable forces Electron to run as plain Node.js,
// breaking require('electron') in the main process.
delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('child_process')
const command = process.argv.slice(2).join(' ')

const child = spawn(command, {
  stdio: 'inherit',
  env: process.env,
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 1))
