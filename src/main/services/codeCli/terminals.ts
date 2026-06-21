import { terminalApps, type TerminalConfig, type TerminalConfigWithCommand } from '@shared/types/codeCli'

export const MACOS_TERMINALS: TerminalConfig[] = [
  {
    id: terminalApps.systemDefault,
    name: 'Terminal',
    bundleId: 'com.apple.Terminal'
  },
  {
    id: terminalApps.iterm2,
    name: 'iTerm2',
    bundleId: 'com.googlecode.iterm2'
  },
  {
    id: terminalApps.kitty,
    name: 'kitty',
    bundleId: 'net.kovidgoyal.kitty'
  },
  {
    id: terminalApps.alacritty,
    name: 'Alacritty',
    bundleId: 'org.alacritty'
  },
  {
    id: terminalApps.wezterm,
    name: 'WezTerm',
    bundleId: 'com.github.wez.wezterm'
  },
  {
    id: terminalApps.ghostty,
    name: 'Ghostty',
    bundleId: 'com.mitchellh.ghostty'
  },
  {
    id: terminalApps.tabby,
    name: 'Tabby',
    bundleId: 'org.tabby'
  }
]

export const WINDOWS_TERMINALS: TerminalConfig[] = [
  {
    id: terminalApps.cmd,
    name: 'Command Prompt'
  },
  {
    id: terminalApps.powershell,
    name: 'PowerShell'
  },
  {
    id: terminalApps.windowsTerminal,
    name: 'Windows Terminal'
  },
  {
    id: terminalApps.wsl,
    name: 'WSL (Ubuntu/Debian)'
  },
  {
    id: terminalApps.alacritty,
    name: 'Alacritty'
  },
  {
    id: terminalApps.wezterm,
    name: 'WezTerm'
  }
]

export const WINDOWS_TERMINALS_WITH_COMMANDS: TerminalConfigWithCommand[] = [
  {
    id: terminalApps.cmd,
    name: 'Command Prompt',
    command: (_: string, fullCommand: string) => ({
      command: 'cmd',
      args: ['/c', fullCommand]
    })
  },
  {
    id: terminalApps.powershell,
    name: 'PowerShell',
    command: (_: string, fullCommand: string) => ({
      command: 'powershell',
      args: ['-NoExit', '-Command', `& "${fullCommand}"`]
    })
  },
  {
    id: terminalApps.windowsTerminal,
    name: 'Windows Terminal',
    command: (_: string, fullCommand: string) => ({
      command: 'wt',
      args: ['--', 'cmd', '/c', fullCommand]
    })
  },
  {
    id: terminalApps.wsl,
    name: 'WSL (Ubuntu/Debian)',
    command: (_: string, fullCommand: string) => ({
      command: 'wsl',
      args: ['bash', '-c', `cmd.exe /c '${fullCommand}' ; read -p 'Press Enter to exit'`]
    })
  },
  {
    id: terminalApps.alacritty,
    name: 'Alacritty',
    customPath: '',
    command: (_: string, fullCommand: string) => ({
      command: 'alacritty',
      args: ['-e', 'cmd', '/c', fullCommand]
    })
  },
  {
    id: terminalApps.wezterm,
    name: 'WezTerm',
    customPath: '',
    command: (_: string, fullCommand: string) => ({
      command: 'wezterm',
      args: ['start', '--', 'cmd', '/c', fullCommand]
    })
  }
]

// Helper function to escape strings for AppleScript
const escapeForAppleScript = (str: string): string => {
  // In AppleScript strings, backslashes and double quotes need to be escaped
  // When passed through osascript -e with single quotes, we need:
  // 1. Backslash: \ -> \\
  // 2. Double quote: " -> \"
  return str
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/"/g, '\\"') // Then escape double quotes
}

export const MACOS_TERMINALS_WITH_COMMANDS: TerminalConfigWithCommand[] = [
  {
    id: terminalApps.systemDefault,
    name: 'Terminal',
    bundleId: 'com.apple.Terminal',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na Terminal && sleep 0.5 && osascript -e 'tell application "Terminal" to activate' -e 'tell application "Terminal" to do script "${escapeForAppleScript(fullCommand)}" in front window'`
      ]
    })
  },
  {
    id: terminalApps.iterm2,
    name: 'iTerm2',
    bundleId: 'com.googlecode.iterm2',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na iTerm && sleep 0.8 && osascript -e 'on waitUntilRunning()\n  repeat 50 times\n    tell application "System Events"\n      if (exists process "iTerm2") then exit repeat\n    end tell\n    delay 0.1\n  end repeat\nend waitUntilRunning\n\nwaitUntilRunning()\n\ntell application "iTerm2"\n  if (count of windows) = 0 then\n    create window with default profile\n    delay 0.3\n  else\n    tell current window\n      create tab with default profile\n    end tell\n    delay 0.3\n  end if\n  tell current session of current window to write text "${escapeForAppleScript(fullCommand)}"\n  activate\nend tell'`
      ]
    })
  },
  {
    id: terminalApps.kitty,
    name: 'kitty',
    bundleId: 'net.kovidgoyal.kitty',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `cd "${_directory}" && open -na kitty --args --directory="${_directory}" sh -c "${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "kitty" to activate'`
      ]
    })
  },
  {
    id: terminalApps.alacritty,
    name: 'Alacritty',
    bundleId: 'org.alacritty',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na Alacritty --args --working-directory "${_directory}" -e sh -c "${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "Alacritty" to activate'`
      ]
    })
  },
  {
    id: terminalApps.wezterm,
    name: 'WezTerm',
    bundleId: 'com.github.wez.wezterm',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na WezTerm --args start --new-tab --cwd "${_directory}" -- sh -c "${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "WezTerm" to activate'`
      ]
    })
  },
  {
    id: terminalApps.ghostty,
    name: 'Ghostty',
    bundleId: 'com.mitchellh.ghostty',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `cd "${_directory}" && open -na Ghostty --args --working-directory="${_directory}" -e sh -c "${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "Ghostty" to activate'`
      ]
    })
  },
  {
    id: terminalApps.tabby,
    name: 'Tabby',
    bundleId: 'org.tabby',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `if pgrep -x "Tabby" > /dev/null; then
          open -na Tabby --args open && sleep 0.3
        else
          open -na Tabby --args open && sleep 2
        fi && osascript -e 'tell application "Tabby" to activate' -e 'set the clipboard to "${escapeForAppleScript(fullCommand)}"' -e 'tell application "System Events" to tell process "Tabby" to keystroke "v" using {command down}' -e 'tell application "System Events" to key code 36'`
      ]
    })
  }
]
