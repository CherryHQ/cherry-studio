export const sandboxExamples = [
  {
    id: 'runtime',
    labelKey: 'settings.about.sandbox.examples.runtime',
    expected: 'stdout: { node, platform, cwd }; exitCode: 0',
    timeoutMs: 30000,
    code: 'console.log(JSON.stringify({ node: process.versions.node, platform: process.platform, cwd: process.cwd() }))'
  },
  {
    id: 'files',
    labelKey: 'settings.about.sandbox.examples.files',
    expected: 'stdout: {"content":"sandbox ✓","removed":true}; exitCode: 0',
    timeoutMs: 30000,
    code: `const fs = require('node:fs')
const path = require('node:path')
const dir = fs.mkdtempSync(path.join(process.cwd(), 'files-'))
const original = path.join(dir, 'original.txt')
const renamed = path.join(dir, 'renamed.txt')
fs.writeFileSync(original, 'sandbox ✓', { flag: 'wx' })
fs.renameSync(original, renamed)
const content = fs.readFileSync(renamed, 'utf8')
fs.unlinkSync(renamed)
fs.rmdirSync(dir)
console.log(JSON.stringify({ content, removed: !fs.existsSync(dir) }))`
  },
  {
    id: 'outside_write',
    labelKey: 'settings.about.sandbox.examples.outside_write',
    expected: 'stdout: {"status":"denied","code":"EACCES" | "EPERM"}; exitCode: 0',
    timeoutMs: 30000,
    code: `const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const outside = path.join(process.cwd(), '..', 'sandbox-denial-' + randomUUID())
let denied = false
try {
  fs.writeFileSync(outside, 'boundary probe', { flag: 'wx' })
} catch (error) {
  if (!['EACCES', 'EPERM'].includes(error.code)) throw error
  denied = true
  console.log(JSON.stringify({ status: 'denied', code: error.code }))
}
if (!denied) {
  console.log(JSON.stringify({ status: 'unexpected-access' }))
  process.exitCode = 1
  fs.unlinkSync(outside)
}`
  },
  {
    id: 'environment',
    labelKey: 'settings.about.sandbox.examples.environment',
    expected: 'stdout: { nodeMode: "1", tempMatchesCwd: true, keys: [...] }; exitCode: 0',
    timeoutMs: 30000,
    code: `console.log(JSON.stringify({
  nodeMode: process.env.ELECTRON_RUN_AS_NODE,
  tempMatchesCwd: process.env.TEMP === process.cwd() && process.env.TMP === process.cwd(),
  keys: Object.keys(process.env).sort()
}))`
  },
  {
    id: 'network',
    labelKey: 'settings.about.sandbox.examples.network',
    expected: 'EACCES / EPERM → denied; ECONNREFUSED / TIMEOUT → inconclusive; connect → unexpected-access',
    timeoutMs: 10000,
    code: `const net = require('node:net')
const socket = net.createConnection({ host: '127.0.0.1', port: 9 })
socket.setTimeout(2000)
socket.on('connect', () => {
  console.log(JSON.stringify({ status: 'unexpected-access' }))
  process.exitCode = 1
  socket.destroy()
})
socket.on('error', (error) => {
  const denied = ['EACCES', 'EPERM'].includes(error.code)
  console.log(JSON.stringify({ status: denied ? 'denied' : 'inconclusive', code: error.code }))
  if (!denied) process.exitCode = 2
})
socket.on('timeout', () => {
  console.log(JSON.stringify({ status: 'inconclusive', code: 'TIMEOUT' }))
  process.exitCode = 2
  socket.destroy()
})`
  },
  {
    id: 'exit',
    labelKey: 'settings.about.sandbox.examples.exit',
    expected: 'stdout: stdout ✓; stderr: stderr ✓; exitCode: 23',
    timeoutMs: 30000,
    code: `process.stdout.write('stdout ✓\\n')
process.stderr.write('stderr ✓\\n')
process.exitCode = 23`
  },
  {
    id: 'timeout',
    labelKey: 'settings.about.sandbox.examples.timeout',
    expected: 'reason: limit; target.status: exited; cleanup: complete',
    timeoutMs: 1000,
    code: `console.log('started')
setInterval(() => {}, 1000)`
  },
  {
    id: 'output',
    labelKey: 'settings.about.sandbox.examples.output',
    expected: 'issues: LIMIT_EXCEEDED; target.status: exited; cleanup: complete',
    timeoutMs: 10000,
    code: `const chunk = '.'.repeat(1023) + '\\n'
const timer = setInterval(() => {
  process.stdout.write(chunk)
}, 1)
setTimeout(() => clearInterval(timer), 5000)`
  }
] as const
