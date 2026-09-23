const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const include = fs.readFileSync(path.join(root, 'build', 'nsis-installer.nsh'), 'utf8')
const uninstallMacro = include.match(/!macro customUnInstall[\s\S]*?!macroend/)?.[0]
if (!uninstallMacro) throw new Error('customUnInstall macro is missing')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'the-boss-nsis-'))
const source = path.join(work, 'preflight.nsi')
const output = path.join(work, 'preflight.exe').replaceAll('\\', '\\\\')
fs.writeFileSync(
  source,
  `Unicode true
Name "The Boss NSIS preflight"
OutFile "${output}"
InstallDir "$TEMP\\The Boss"
!include LogicLib.nsh
!define APP_EXECUTABLE_FILENAME "The Boss.exe"
!define isUpdated 0
${uninstallMacro}
Section
  !insertmacro customUnInstall
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
const result = spawnSync(executable, ['/V4', source], { encoding: 'utf8' })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
fs.rmSync(work, { recursive: true, force: true })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`NSIS preflight failed with exit code ${result.status}`)
