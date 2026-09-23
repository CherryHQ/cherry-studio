import fs from 'node:fs/promises'
import path from 'node:path'
import { application } from '@application'
import { mergePathPrefixes } from '@main/utils/binaryEnv'
import { integrationDirectory } from './integrationConfig'
import { runIntegrationProcess } from './integrationProcess'
import { installMiniCommands } from './miniCommands'

const marker = '# The Boss managed commands'
const endMarker = '# End The Boss managed commands'
const registrationFile = () => path.join(integrationDirectory(), 'path-registration.json')
type Registration = { directory: string; added: boolean; files: string[] }

export async function commandPathInstalled(): Promise<boolean> {
  try {
    const value = JSON.parse(await fs.readFile(registrationFile(), 'utf8')) as Registration
    await fs.access(path.join(value.directory, process.platform === 'win32' ? 'compass.exe' : 'compass'))
    if (process.platform === 'win32') {
      const script = "[Environment]::GetEnvironmentVariable('Path', 'User')"
      const output = await runIntegrationProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
      return output.trim().split(';').some((entry) => entry.replace(/\\$/, '').toLowerCase() === value.directory.replace(/\\$/, '').toLowerCase())
    }
    return (await Promise.all(value.files.map(async (file) => (await fs.readFile(file, 'utf8')).includes(marker)))).every(Boolean)
  } catch { return false }
}

export async function installCommandPath(): Promise<void> {
  const directory = application.getPath('feature.prometheus.commands')
  await fs.mkdir(directory, { recursive: true })
  // Stable, application-owned executables survive versioned installation directory changes.
  for (const tool of ['compass', 'rust-mcp-filesystem', 'prometheus', 'pk', 'node']) {
    const filename = process.platform === 'win32' ? `${tool}.exe` : tool
    await fs.copyFile(path.join(application.getPath('cherry.bin'), filename), path.join(directory, filename))
    if (process.platform !== 'win32') await fs.chmod(path.join(directory, filename), 0o755)
  }
  await installMiniCommands(directory)
  let registration: Registration = { directory, added: false, files: [] }
  try { registration = JSON.parse(await fs.readFile(registrationFile(), 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (process.platform === 'win32') {
    const script = `$ErrorActionPreference = 'Stop'
$directory = $env:BOSS_COMMAND_DIRECTORY
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($current -split ';' | Where-Object { $_ })
if (-not ($entries | Where-Object { $_.TrimEnd('\\') -ieq $directory.TrimEnd('\\') })) {
  [Environment]::SetEnvironmentVariable('Path', (($entries + $directory) -join ';'), 'User')
  Write-Output 'added'
}
Add-Type -Namespace Boss -Name Environment -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'
$result = [UIntPtr]::Zero
[void][Boss.Environment]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)`
    const output = await runIntegrationProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { BOSS_COMMAND_DIRECTORY: directory } })
    registration.added ||= output.includes('added')
  } else {
    const home = application.getPath('sys.home')
    const quoted = `'${directory.replace(/'/g, `'"'"'`)}'`
    const executable = process.env.APPIMAGE || application.getPath('app.exe_file')
    const quotedExecutable = `'${executable.replace(/'/g, `'"'"'`)}'`
    const cleanup = path.join(directory, 'remove-registration.cjs')
    await fs.writeFile(cleanup, `const fs=require('node:fs');
if(fs.existsSync(${JSON.stringify(executable)})) process.exit(0);
const file=${JSON.stringify(registrationFile())};
if(!fs.existsSync(file)) process.exit(0);
const registration=JSON.parse(fs.readFileSync(file,'utf8'));
for(const filename of registration.files){
 if(!fs.existsSync(filename)) continue;
 const text=fs.readFileSync(filename,'utf8'), start=text.indexOf(${JSON.stringify(marker)}), end=text.indexOf(${JSON.stringify(endMarker)},start);
 if(start!==-1 && end!==-1) fs.writeFileSync(filename,text.slice(0,start)+text.slice(end+${endMarker.length}));
}
fs.rmSync(file,{force:true});
`)
    const shell = `if [ -f ${quotedExecutable} ]; then\n  _boss_commands=${quoted}\n  case ":$PATH:" in *":$_boss_commands:"*) ;; *) export PATH="$_boss_commands:$PATH" ;; esac\n  unset _boss_commands\nelse\n  ${quoted}/node ${quoted}/remove-registration.cjs\nfi`
    const blocks = new Map([
      ['.profile', shell], ['.bashrc', shell], ['.bash_profile', shell], ['.zprofile', shell], ['.zshrc', shell],
      [path.join('.config', 'fish', 'conf.d', 'the-boss.fish'), `if test -f ${quotedExecutable}\n  fish_add_path --path ${quoted}\nelse\n  ${quoted}/node ${quoted}/remove-registration.cjs\nend`]
    ])
    for (const [relative, command] of blocks) {
      const file = path.join(home, relative)
      let content = ''
      try { content = await fs.readFile(file, 'utf8') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const start = content.indexOf(marker)
      const end = content.indexOf(endMarker, start)
      const block = `${marker}\n${command}\n${endMarker}`
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, start !== -1 && end !== -1 ? content.slice(0, start) + block + content.slice(end + endMarker.length) : `${content}\n${block}\n`)
      if (!registration.files.includes(file)) registration.files.push(file)
    }
    registration.added = true
  }
  await fs.mkdir(integrationDirectory(), { recursive: true, mode: 0o700 })
  await fs.writeFile(registrationFile(), JSON.stringify(registration), { mode: 0o600 })
  Object.assign(process.env, mergePathPrefixes(Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), [directory]))
}

export async function removeCommandPath(): Promise<void> {
  let registration: Registration
  try { registration = JSON.parse(await fs.readFile(registrationFile(), 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (process.platform === 'win32' && registration.added) {
    const script = `$value = [Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', (($value -split ';' | Where-Object { $_.TrimEnd('\\') -ine $env:BOSS_COMMAND_DIRECTORY.TrimEnd('\\') }) -join ';'), 'User')`
    await runIntegrationProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { BOSS_COMMAND_DIRECTORY: registration.directory } })
  }
  for (const file of registration.files) {
    const content = await fs.readFile(file, 'utf8')
    const start = content.indexOf(marker)
    const end = content.indexOf(endMarker, start)
    if (start !== -1 && end !== -1) await fs.writeFile(file, content.slice(0, start) + content.slice(end + endMarker.length))
  }
  await fs.rm(registrationFile(), { force: true })
}
