import { TerminalApp, type TerminalConfig, type TerminalConfigWithCommand } from '@shared/types/codeCli'

import { escapeForDoubleQuotes, posixQuote } from './shellQuote'

export const MACOS_TERMINALS: TerminalConfig[] = [
  {
    id: TerminalApp.SYSTEM_DEFAULT,
    name: 'Terminal',
    bundleId: 'com.apple.Terminal'
  },
  {
    id: TerminalApp.ITERM2,
    name: 'iTerm2',
    bundleId: 'com.googlecode.iterm2'
  },
  {
    id: TerminalApp.KITTY,
    name: 'kitty',
    bundleId: 'net.kovidgoyal.kitty'
  },
  {
    id: TerminalApp.ALACRITTY,
    name: 'Alacritty',
    bundleId: 'org.alacritty'
  },
  {
    id: TerminalApp.WEZTERM,
    name: 'WezTerm',
    bundleId: 'com.github.wez.wezterm'
  },
  {
    id: TerminalApp.GHOSTTY,
    name: 'Ghostty',
    bundleId: 'com.mitchellh.ghostty'
  },
  {
    id: TerminalApp.TABBY,
    name: 'Tabby',
    bundleId: 'org.tabby'
  }
]

export const WINDOWS_TERMINALS: TerminalConfig[] = [
  {
    id: TerminalApp.CMD,
    name: 'Command Prompt'
  },
  {
    id: TerminalApp.POWERSHELL,
    name: 'PowerShell'
  },
  {
    id: TerminalApp.WINDOWS_TERMINAL,
    name: 'Windows Terminal'
  },
  {
    id: TerminalApp.WSL,
    name: 'WSL (Ubuntu/Debian)'
  },
  {
    id: TerminalApp.ALACRITTY,
    name: 'Alacritty'
  },
  {
    id: TerminalApp.WEZTERM,
    name: 'WezTerm'
  }
]

export const WINDOWS_TERMINALS_WITH_COMMANDS: TerminalConfigWithCommand[] = [
  {
    id: TerminalApp.CMD,
    name: 'Command Prompt',
    command: (_: string, fullCommand: string) => ({
      command: 'cmd',
      args: ['/c', fullCommand]
    })
  },
  {
    id: TerminalApp.POWERSHELL,
    name: 'PowerShell',
    command: (_: string, fullCommand: string) => ({
      command: 'powershell',
      args: ['-NoExit', '-Command', `& "${fullCommand}"`]
    })
  },
  {
    id: TerminalApp.WINDOWS_TERMINAL,
    name: 'Windows Terminal',
    command: (_: string, fullCommand: string) => ({
      command: 'wt',
      args: ['--', 'cmd', '/c', fullCommand]
    })
  },
  {
    id: TerminalApp.WSL,
    name: 'WSL (Ubuntu/Debian)',
    command: (_: string, fullCommand: string) => ({
      command: 'wsl',
      args: ['bash', '-c', `cmd.exe /c '${fullCommand}' ; read -p 'Press Enter to exit'`]
    })
  },
  {
    id: TerminalApp.ALACRITTY,
    name: 'Alacritty',
    command: (_: string, fullCommand: string) => ({
      command: 'alacritty',
      args: ['-e', 'cmd', '/c', fullCommand]
    })
  },
  {
    id: TerminalApp.WEZTERM,
    name: 'WezTerm',
    command: (_: string, fullCommand: string) => ({
      command: 'wezterm',
      args: ['start', '--', 'cmd', '/c', fullCommand]
    })
  }
]

// Helper function to escape strings for AppleScript
export const escapeForAppleScript = (str: string): string => {
  // The string is embedded as an AppleScript literal ("…") which is itself embedded in an
  // `osascript -e '…'` single-quoted argument, so it must be escaped for BOTH layers:
  // 1. Backslash: \ -> \\        (AppleScript string literal)
  // 2. Double quote: " -> \"     (AppleScript string literal)
  // 3. Single quote: ' -> '\''   (closes the osascript -e '…' quote, emits a literal quote, reopens)
  //    Without (3) a single quote in the command — e.g. from a single-quoted directory token — would
  //    terminate the -e argument early and expose the rest to the outer `sh -c`.
  return str
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/"/g, '\\"') // Then escape double quotes (AppleScript layer)
    .replace(/'/g, `'\\''`) // Finally escape single quotes for the osascript -e '…' layer
}

export const MACOS_TERMINALS_WITH_COMMANDS: TerminalConfigWithCommand[] = [
  {
    id: TerminalApp.SYSTEM_DEFAULT,
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
    id: TerminalApp.ITERM2,
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
    id: TerminalApp.KITTY,
    name: 'kitty',
    bundleId: 'net.kovidgoyal.kitty',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `cd ${posixQuote(_directory)} && open -na kitty --args --directory=${posixQuote(_directory)} sh -c "${escapeForDoubleQuotes(fullCommand)}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "kitty" to activate'`
      ]
    })
  },
  {
    id: TerminalApp.ALACRITTY,
    name: 'Alacritty',
    bundleId: 'org.alacritty',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na Alacritty --args --working-directory ${posixQuote(_directory)} -e sh -c "${escapeForDoubleQuotes(fullCommand)}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "Alacritty" to activate'`
      ]
    })
  },
  {
    id: TerminalApp.WEZTERM,
    name: 'WezTerm',
    bundleId: 'com.github.wez.wezterm',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na WezTerm --args start --new-tab --cwd ${posixQuote(_directory)} -- sh -c "${escapeForDoubleQuotes(fullCommand)}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "WezTerm" to activate'`
      ]
    })
  },
  {
    id: TerminalApp.GHOSTTY,
    name: 'Ghostty',
    bundleId: 'com.mitchellh.ghostty',
    command: (_directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `cd ${posixQuote(_directory)} && open -na Ghostty --args --working-directory=${posixQuote(_directory)} -e sh -c "${escapeForDoubleQuotes(fullCommand)}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "Ghostty" to activate'`
      ]
    })
  },
  {
    id: TerminalApp.TABBY,
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
