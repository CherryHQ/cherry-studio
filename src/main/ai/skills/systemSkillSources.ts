import * as path from 'node:path'

export interface SystemSkillSource {
  id: string
  name: string
  directoryPath: string
}

function resolveHomePath(home: string, configuredPath: string | undefined, fallback: string[]): string {
  const value = configuredPath?.trim()
  return value ? path.resolve(home, value) : path.join(home, ...fallback)
}

/**
 * Known system-level skill locations used by current agent CLIs.
 *
 * These are discovery roots only. Workspace/project roots are intentionally
 * absent because they are handled by SkillService.listLocal().
 */
export function buildSystemSkillSources(home: string, env: Record<string, string>): SystemSkillSource[] {
  const configHome = resolveHomePath(home, env.XDG_CONFIG_HOME, ['.config'])
  const claudeHome = resolveHomePath(home, env.CLAUDE_CONFIG_DIR, ['.claude'])
  const codexHome = resolveHomePath(home, env.CODEX_HOME, ['.codex'])

  return [
    { id: 'agents', name: 'Agent Skills', directoryPath: path.join(home, '.agents', 'skills') },
    { id: 'agents-xdg', name: 'Agent Skills', directoryPath: path.join(configHome, 'agents', 'skills') },
    { id: 'claude-code', name: 'Claude Code', directoryPath: path.join(claudeHome, 'skills') },
    { id: 'codex', name: 'Codex', directoryPath: path.join(codexHome, 'skills') },
    { id: 'cursor', name: 'Cursor', directoryPath: path.join(home, '.cursor', 'skills') },
    { id: 'gemini-cli', name: 'Gemini CLI', directoryPath: path.join(home, '.gemini', 'skills') },
    { id: 'github-copilot', name: 'GitHub Copilot', directoryPath: path.join(home, '.copilot', 'skills') },
    { id: 'opencode', name: 'OpenCode', directoryPath: path.join(configHome, 'opencode', 'skills') },
    { id: 'openclaw', name: 'OpenClaw', directoryPath: path.join(home, '.openclaw', 'skills') },
    { id: 'clawdbot', name: 'ClawdBot', directoryPath: path.join(home, '.clawdbot', 'skills') },
    { id: 'moltbot', name: 'MoltBot', directoryPath: path.join(home, '.moltbot', 'skills') },
    { id: 'qoder', name: 'Qoder', directoryPath: path.join(home, '.qoder', 'skills') },
    { id: 'qoder-cn', name: 'Qoder CN', directoryPath: path.join(home, '.qoder-cn', 'skills') },
    { id: 'qwen-code', name: 'Qwen Code', directoryPath: path.join(home, '.qwen', 'skills') }
  ]
}
