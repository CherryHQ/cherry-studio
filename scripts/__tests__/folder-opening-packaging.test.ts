import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('folder opening packaging', () => {
  it('advertises directories alongside the existing Linux URL handler', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      linux: { mimeTypes: string[] }
    }
    expect(config.linux.mimeTypes).toContain('inode/directory')
    expect(config.linux.mimeTypes).toContain('x-scheme-handler/cherrystudio')
  })

  it('installs and removes only the owned folder verb in the selected installation hive', () => {
    const script = readFileSync(path.join(projectRoot, 'build/nsis-installer.nsh'), 'utf8')
    const install = script.match(/!macro customInstall\n([\s\S]*?)!macroend/)?.[1]
    const uninstall = script.match(/!macro customUnInstall\n([\s\S]*?)!macroend/)?.[1]
    expect(install).toBeDefined()
    expect(uninstall).toBeDefined()
    expect(script.indexOf('!macro customInstall')).toBeGreaterThan(script.indexOf('FunctionEnd\n!endif'))
    expect(script.indexOf('!macro customUnInstall')).toBeGreaterThan(script.indexOf('FunctionEnd\n!endif'))
    const key = String.raw`Software\Classes\Directory\shell\CherryStudio`
    const command = String.raw`'$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'`
    for (const macro of [install!, uninstall!]) {
      expect(macro).toContain('${If} $installMode == "all"')
      expect(macro).not.toMatch(/UserInfo|SetRegView|Directory\\background/)
    }
    for (const [branch, hive] of ['HKLM', 'HKCU'].entries()) {
      expect(install!.split('${Else}')[branch]).toContain(`WriteRegStr ${hive} "${key}\\command" "" ${command}`)
      expect(uninstall!.split('${Else}')[branch]).toContain(`DeleteRegKey ${hive} "${key}"`)
    }
    expect(uninstall!.match(/DeleteRegKey[^\n]+/g)).toHaveLength(2)
    expect(install!.match(/WriteRegStr[^\n]+/g)).toHaveLength(4)
  })
})
