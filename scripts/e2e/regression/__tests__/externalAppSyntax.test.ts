import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MAC_EXTERNAL_APP_SCRIPT } from '../externalAppMac'
import { WINDOWS_EXTERNAL_APP_SCRIPT } from '../externalAppWindows'

it.skipIf(process.platform !== 'darwin')('compiles the macOS cleanup adapter without launching applications', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-native-syntax-'))
  try {
    const source = join(directory, 'cleanup.js')
    const compiled = join(directory, 'cleanup.scpt')
    writeFileSync(source, MAC_EXTERNAL_APP_SCRIPT)
    execFileSync('osacompile', ['-l', 'JavaScript', '-o', compiled, source])
    expect(readFileSync(compiled).byteLength).toBeGreaterThan(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(process.platform !== 'win32')(
  'parses the Windows cleanup adapter without executing native operations',
  () => {
    const encoded = Buffer.from(WINDOWS_EXTERNAL_APP_SCRIPT).toString('base64')
    const result = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
    $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
    $tokens = $null
    $errors = $null
    [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) { throw ($errors.Message -join '; ') }
    'parsed'
  `
      ],
      { encoding: 'utf8' }
    )
    expect(result.trim()).toBe('parsed')
  }
)
