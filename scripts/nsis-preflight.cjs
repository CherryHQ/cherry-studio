const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const include = fs.readFileSync(path.join(root, 'build', 'nsis-installer.nsh'), 'utf8')
const uninstallCommand = include.match(/^\s*ExecWait .*--remove-managed-path.*$/m)?.[0].trim()
if (!uninstallCommand) throw new Error('Managed PATH uninstall command is missing')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'the-boss-nsis-'))
const source = path.join(work, 'preflight.nsi')
const output = path.join(work, 'preflight.exe').replaceAll('\\', '\\\\')
fs.writeFileSync(
  source,
  `Unicode true
Name "The Boss NSIS preflight"
OutFile "${output}"
InstallDir "$TEMP\\The Boss"
!define APP_EXECUTABLE_FILENAME "The Boss.exe"
Section
  ${uninstallCommand}
SectionEnd
`
)

const candidates = [
  'makensis.exe',
  path.join(process.env['ProgramFiles(x86)'] || '', 'NSIS', 'makensis.exe'),
  path.join(process.env.ProgramFiles || '', 'NSIS', 'makensis.exe')
]
const executable =
  candidates.find((candidate) => candidate !== 'makensis.exe' && fs.existsSync(candidate)) || 'makensis.exe'
const result = spawnSync(executable, ['/WX', '/V4', source], { encoding: 'utf8' })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
fs.rmSync(work, { recursive: true, force: true })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`NSIS preflight failed with exit code ${result.status}`)
