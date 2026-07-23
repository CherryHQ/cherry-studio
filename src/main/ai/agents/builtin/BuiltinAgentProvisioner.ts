/**
 * BuiltinAgentProvisioner
 *
 * Provisions built-in agent workspaces by copying template files
 * (agent.json, .claude/skills/, .claude/plugins.json) from bundled
 * resources into the agent's working directory.
 *
 * The Claude Agent SDK auto-discovers skills from .claude/skills/ and
 * plugins from .claude/plugins.json, so no programmatic injection is needed.
 */
import { application } from '@application'
import { loggerService } from '@logger'
import { getAppLanguage } from '@main/i18n'
import fs from 'fs'
import path from 'path'

const logger = loggerService.withContext('BuiltinAgentProvisioner')

/** Resolve a localized field: string passes through; locale-keyed object resolves by current language. */
function resolveLocalizedField(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined

  const map = value as Record<string, string>
  const lang = getAppLanguage()
  const prefix = lang.split('-')[0]
  const prefixKey = Object.keys(map).find((k) => k.startsWith(prefix))

  return map[lang] || (prefixKey && map[prefixKey]) || map['en-US'] || Object.values(map)[0]
}

const TEMPLATE_NAME_BY_ROLE: Record<string, string> = {
  assistant: 'cherry-assistant'
}

function getTemplateDir(builtinRole: string): string | undefined {
  const templateName = TEMPLATE_NAME_BY_ROLE[builtinRole]
  if (!templateName) {
    logger.warn('Unknown builtin role, skipping provisioning', { builtinRole })
    return undefined
  }

  return path.join(application.getPath('feature.agents.builtin'), templateName)
}

/**
 * Recursively copy a directory, creating target dirs as needed.
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// No `description` here: the builtin agent's display/search description is owned by i18n
// (`agent.builtin.cherry_assistant.description`), not the bundle — a bundle copy would be a
// drift-prone second source of truth.
export interface BuiltinAgentConfig {
  name?: string
  instructions?: string
  configuration?: Record<string, unknown>
}

export function loadBuiltinAgentDefinition(builtinRole: string): BuiltinAgentConfig | undefined {
  const templateDir = getTemplateDir(builtinRole)
  if (!templateDir) return undefined

  const agentJsonPath = path.join(templateDir, 'agent.json')
  if (!fs.existsSync(agentJsonPath)) {
    logger.error('Builtin agent definition not found', { agentJsonPath, builtinRole })
    return undefined
  }

  try {
    const agentConfig = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'))
    return {
      name: resolveLocalizedField(agentConfig.name),
      instructions: resolveLocalizedField(agentConfig.instructions),
      configuration: agentConfig.configuration
    } as BuiltinAgentConfig
  } catch (error) {
    logger.error('Failed to load builtin agent definition', {
      builtinRole,
      agentJsonPath,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

/**
 * Provision a built-in agent's workspace with template files.
 *
 * Writes .claude/skills/ and .claude/plugins.json to the agent's
 * working directory so the SDK can auto-discover them.
 *
 * @param workspacePath - The agent session's workspace directory
 * @param builtinRole - The built-in role identifier (currently only 'assistant')
 * @returns The parsed agent.json config, or undefined if not found
 */
export async function provisionBuiltinAgent(
  workspacePath: string,
  builtinRole: string
): Promise<BuiltinAgentConfig | undefined> {
  const templateDir = getTemplateDir(builtinRole)
  if (!templateDir) return undefined

  if (!fs.existsSync(templateDir)) {
    logger.error('Builtin agent template not found', { templateDir, builtinRole })
    return undefined
  }

  try {
    // Always overwrite .claude/ (skills + plugins.json) — this is product-managed content
    // that must stay in sync with each release (e.g., knowledge base updates in SKILL.md).
    // User-customized content (SOUL.md, USER.md, memory/) is handled separately below.
    const srcClaudeDir = path.join(templateDir, '.claude')
    const destClaudeDir = path.join(workspacePath, '.claude')

    if (fs.existsSync(srcClaudeDir)) {
      copyDirSync(srcClaudeDir, destClaudeDir)
      logger.info('Provisioned .claude/ directory for builtin agent', {
        builtinRole,
        workspacePath,
        destClaudeDir
      })
    }

    // Copy SOUL.md, USER.md, and memory/ only if they don't already exist (first-time provision)
    // Never overwrite — user may have customized their persona or accumulated memories
    // workspacePath is created by the .claude/ copy above (every builtin template ships .claude/skills/)
    for (const soulFile of ['SOUL.md', 'USER.md']) {
      const srcFile = path.join(templateDir, soulFile)
      const destFile = path.join(workspacePath, soulFile)
      if (fs.existsSync(srcFile) && !fs.existsSync(destFile)) {
        fs.copyFileSync(srcFile, destFile)
      }
    }

    const srcMemoryDir = path.join(templateDir, 'memory')
    const destMemoryDir = path.join(workspacePath, 'memory')
    if (fs.existsSync(srcMemoryDir) && !fs.existsSync(destMemoryDir)) {
      copyDirSync(srcMemoryDir, destMemoryDir)
    }

    return loadBuiltinAgentDefinition(builtinRole)
  } catch (error) {
    logger.error('Failed to provision builtin agent workspace', {
      builtinRole,
      workspacePath,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}
