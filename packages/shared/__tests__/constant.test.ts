import { describe, expect, it } from 'vitest'

import { terminalApps, WINDOWS_TERMINALS_WITH_COMMANDS } from '../config/constant'

describe('WINDOWS_TERMINALS_WITH_COMMANDS', () => {
  const batPath = 'C:\\Users\\Test User\\AppData\\Local\\Temp\\cherrystudio\\launch_claude-code_1.bat'

  it('quotes the command prompt launch script path', () => {
    const config = WINDOWS_TERMINALS_WITH_COMMANDS.find((item) => item.id === terminalApps.cmd)
    expect(config?.command('', batPath)).toEqual({
      command: 'cmd',
      args: ['/c', `"${batPath}"`]
    })
  })

  it('quotes the windows terminal launch script path', () => {
    const config = WINDOWS_TERMINALS_WITH_COMMANDS.find((item) => item.id === terminalApps.windowsTerminal)
    expect(config?.command('', batPath)).toEqual({
      command: 'wt',
      args: ['-p', 'Command Prompt', '--', 'cmd', '/c', `"${batPath}"`]
    })
  })

  it('quotes the alternative terminal launch script path', () => {
    const alacritty = WINDOWS_TERMINALS_WITH_COMMANDS.find((item) => item.id === terminalApps.alacritty)
    const wezterm = WINDOWS_TERMINALS_WITH_COMMANDS.find((item) => item.id === terminalApps.wezterm)

    expect(alacritty?.command('', batPath)).toEqual({
      command: 'alacritty',
      args: ['-e', 'cmd', '/c', `"${batPath}"`]
    })
    expect(wezterm?.command('', batPath)).toEqual({
      command: 'wezterm',
      args: ['start', '--', 'cmd', '/c', `"${batPath}"`]
    })
  })

  it('quotes the wsl launch script path before delegating to cmd.exe', () => {
    const config = WINDOWS_TERMINALS_WITH_COMMANDS.find((item) => item.id === terminalApps.wsl)
    expect(config?.command('', batPath)).toEqual({
      command: 'wsl',
      args: ['bash', '-c', `cmd.exe /c "${batPath}" ; read -p 'Press Enter to exit'`]
    })
  })
})
