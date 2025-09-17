import { languages } from './languages'

export const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
export const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv']
export const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac']
export const documentExts = ['.pdf', '.doc', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods']
export const thirdPartyApplicationExts = ['.draftsExport']
export const bookExts = ['.epub']

/**
 * A flat array of all file extensions known by the linguist database.
 * This is the primary source for identifying code files.
 */
const linguistExtSet = new Set<string>()
for (const lang of Object.values(languages)) {
  if (lang.extensions) {
    for (const ext of lang.extensions) {
      linguistExtSet.add(ext)
    }
  }
}
export const codeLangExts = Array.from(linguistExtSet)

/**
 * A categorized map of custom text-based file extensions that are NOT included
 * in the linguist database. This is for special cases or project-specific files.
 */
export const customTextExts = new Map([
  [
    'language',
    [
      '.R', // R
      '.ets', // OpenHarmony,
      '.uniswap', // DeFi
      '.usf', // Unreal shader format
      '.ush' // Unreal shader header
    ]
  ],
  [
    'template',
    [
      '.vm' // Velocity
    ]
  ],
  [
    'config',
    [
      '.babelrc', // Babel
      '.bashrc',
      '.browserslistrc',
      '.conf',
      '.config', // 通用配置
      '.dockerignore', // Docker ignore
      '.eslintignore',
      '.eslintrc', // ESLint
      '.fishrc', // Fish shell配置
      '.htaccess', // Apache配置
      '.npmignore',
      '.npmrc', // npm
      '.prettierignore',
      '.prettierrc', // Prettier
      '.rc',
      '.robots', // robots.txt
      '.yarnrc',
      '.zshrc'
    ]
  ],
  [
    'document',
    [
      '.authors', // 作者文件
      '.changelog', // 变更日志
      '.license', // 许可证
      '.nfo', // 信息文件
      '.readme',
      '.text' // 纯文本
    ]
  ],
  [
    'data',
    [
      '.atom', // Feed格式
      '.ldif',
      '.map',
      '.ndjson' // 换行分隔JSON
    ]
  ],
  [
    'build',
    [
      '.bazel', // Bazel
      '.build', // Meson
      '.pom'
    ]
  ],
  [
    'database',
    [
      '.dml', // DDL/DML
      '.psql' // PostgreSQL
    ]
  ],
  [
    'web',
    [
      '.openapi', // API文档
      '.swagger'
    ]
  ],
  [
    'version',
    [
      '.bzrignore', // Bazaar ignore
      '.gitattributes', // Git attributes
      '.githistory', // Git history
      '.hgignore', // Mercurial ignore
      '.svnignore' // SVN ignore
    ]
  ],
  [
    'subtitle',
    [
      '.ass', // 字幕格式
      '.sub'
    ]
  ],
  [
    'log',
    [
      '.log',
      '.rpt' // 日志和报告 (移除了.out，因为通常是二进制可执行文件)
    ]
  ],
  [
    'eda',
    [
      '.cir',
      '.def', // LEF/DEF
      '.edif', // EDIF
      '.il',
      '.ils', // SKILL
      '.lef',
      '.net',
      '.scs', // Spectre
      '.sdf', // SDF
      '.spi'
    ]
  ]
])

/**
 * A comprehensive list of all text-based file extensions, combining the
 * extensive list from the linguist database with our custom additions.
 * The Set ensures there are no duplicates.
 */
export const textExts = [...new Set([...Array.from(customTextExts.values()).flat(), ...codeLangExts])]

export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

// 从 ZOOM_LEVELS 生成 Ant Design Select 所需的 options 结构
export const ZOOM_OPTIONS = ZOOM_LEVELS.map((level) => ({
  value: level,
  label: `${Math.round(level * 100)}%`
}))

export const ZOOM_SHORTCUTS = [
  {
    key: 'zoom_in',
    shortcut: ['CommandOrControl', '='],
    editable: false,
    enabled: true,
    system: true
  },
  {
    key: 'zoom_out',
    shortcut: ['CommandOrControl', '-'],
    editable: false,
    enabled: true,
    system: true
  },
  {
    key: 'zoom_reset',
    shortcut: ['CommandOrControl', '0'],
    editable: false,
    enabled: true,
    system: true
  }
]

export const KB = 1024
export const MB = 1024 * KB
export const GB = 1024 * MB
export const defaultLanguage = 'en-US'

export enum FeedUrl {
  PRODUCTION = 'https://releases.cherry-ai.com',
  GITHUB_LATEST = 'https://github.com/CherryHQ/cherry-studio/releases/latest/download'
}

export enum UpgradeChannel {
  LATEST = 'latest', // 最新稳定版本
  RC = 'rc', // 公测版本
  BETA = 'beta' // 预览版本
}

export const defaultTimeout = 10 * 1000 * 60

export const occupiedDirs = ['logs', 'Network', 'Partitions/webview/Network']

export const MIN_WINDOW_WIDTH = 960
export const SECOND_MIN_WINDOW_WIDTH = 520
export const MIN_WINDOW_HEIGHT = 600
export const defaultByPassRules = 'localhost,127.0.0.1,::1'

export enum codeTools {
  qwenCode = 'qwen-code',
  claudeCode = 'claude-code',
  geminiCli = 'gemini-cli',
  openaiCodex = 'openai-codex',
  iFlowCli = 'iflow-cli'
}

export enum terminalApps {
  systemDefault = 'Terminal',
  iterm2 = 'iTerm2',
  warp = 'Warp',
  kitty = 'kitty',
  alacritty = 'Alacritty',
  wezterm = 'WezTerm',
  ghostty = 'Ghostty',
  // Windows terminals
  windowsTerminal = 'WindowsTerminal',
  powershell = 'PowerShell',
  cmd = 'CMD',
  wsl = 'WSL'
}

export interface TerminalConfig {
  id: string
  name: string
  bundleId?: string
  customPath?: string // For user-configured terminal paths on Windows
}

export interface TerminalConfigWithCommand extends TerminalConfig {
  command: (directory: string, fullCommand: string) => { command: string; args: string[] }
}

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
    id: terminalApps.warp,
    name: 'Warp',
    bundleId: 'dev.warp.Warp-Stable'
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
      args: ['/c', 'start', 'cmd', '/k', fullCommand]
    })
  },
  {
    id: terminalApps.powershell,
    name: 'PowerShell',
    command: (_: string, fullCommand: string) => ({
      command: 'cmd',
      args: ['/c', 'start', 'powershell', '-NoExit', '-Command', `& '${fullCommand}'`]
    })
  },
  {
    id: terminalApps.windowsTerminal,
    name: 'Windows Terminal',
    command: (_: string, fullCommand: string) => ({
      command: 'wt',
      args: ['cmd', '/k', fullCommand]
    })
  },
  {
    id: terminalApps.wsl,
    name: 'WSL (Ubuntu/Debian)',
    command: (_: string, fullCommand: string) => {
      // Start WSL in a new window and execute the batch file from within WSL using cmd.exe
      // The batch file will run in Windows context but output will be in WSL terminal
      return {
        command: 'cmd',
        args: ['/c', 'start', 'wsl', '-e', 'bash', '-c', `cmd.exe /c '${fullCommand}' ; exec bash`]
      }
    }
  },
  {
    id: terminalApps.alacritty,
    name: 'Alacritty',
    customPath: '', // Will be set by user in settings
    command: (_: string, fullCommand: string) => ({
      command: 'alacritty', // Will be replaced with customPath if set
      args: ['-e', 'cmd', '/k', fullCommand]
    })
  },
  {
    id: terminalApps.wezterm,
    name: 'WezTerm',
    customPath: '', // Will be set by user in settings
    command: (_: string, fullCommand: string) => ({
      command: 'wezterm', // Will be replaced with customPath if set
      args: ['start', 'cmd', '/k', fullCommand]
    })
  }
]

export const MACOS_TERMINALS_WITH_COMMANDS: TerminalConfigWithCommand[] = [
  {
    id: terminalApps.systemDefault,
    name: 'Terminal',
    bundleId: 'com.apple.Terminal',
    command: (directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na Terminal && sleep 0.5 && osascript -e 'tell application "Terminal" to activate' -e 'tell application "Terminal" to do script "cd '${directory.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' && clear && ${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" in front window'`
      ]
    })
  },
  {
    id: terminalApps.iterm2,
    name: 'iTerm2',
    bundleId: 'com.googlecode.iterm2',
    command: (directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na iTerm && sleep 0.8 && osascript -e 'on waitUntilRunning()\n  repeat 50 times\n    tell application "System Events"\n      if (exists process "iTerm2") then exit repeat\n    end tell\n    delay 0.1\n  end repeat\nend waitUntilRunning\n\nwaitUntilRunning()\n\ntell application "iTerm2"\n  if (count of windows) = 0 then\n    create window with default profile\n    delay 0.3\n  else\n    tell current window\n      create tab with default profile\n    end tell\n    delay 0.3\n  end if\n  tell current session of current window to write text "cd '${directory.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' && clear && ${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n  activate\nend tell'`
      ]
    })
  },
  {
    id: terminalApps.warp,
    name: 'Warp',
    bundleId: 'dev.warp.Warp-Stable',
    command: (directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na Warp && sleep 0.8 && osascript -e 'tell application "Warp" to activate' -e 'tell application "System Events" to tell process "Warp" to keystroke "t" using {command down}' -e 'delay 0.3' -e 'set the clipboard to "cd "${directory.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" && clear && ${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"' -e 'tell application "System Events" to tell process "Warp" to keystroke "v" using {command down}' -e 'tell application "System Events" to key code 36'`
      ]
    })
  },
  {
    id: terminalApps.kitty,
    name: 'kitty',
    bundleId: 'net.kovidgoyal.kitty',
    command: (directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `cd "${directory}" && open -na kitty --args --directory="${directory}" sh -c "${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "kitty" to activate'`
      ]
    })
  },
  {
    id: terminalApps.alacritty,
    name: 'Alacritty',
    bundleId: 'org.alacritty',
    command: (directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na Alacritty --args --working-directory "${directory}" -e sh -c "${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "Alacritty" to activate'`
      ]
    })
  },
  {
    id: terminalApps.wezterm,
    name: 'WezTerm',
    bundleId: 'com.github.wez.wezterm',
    command: (directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `open -na WezTerm --args start --new-tab --cwd "${directory}" -- sh -c "${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "WezTerm" to activate'`
      ]
    })
  },
  {
    id: terminalApps.ghostty,
    name: 'Ghostty',
    bundleId: 'com.mitchellh.ghostty',
    command: (directory: string, fullCommand: string) => ({
      command: 'sh',
      args: [
        '-c',
        `cd "${directory}" && open -na Ghostty --args --working-directory="${directory}" -e sh -c "${fullCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}; exec \\$SHELL" && sleep 0.5 && osascript -e 'tell application "Ghostty" to activate'`
      ]
    })
  }
]
