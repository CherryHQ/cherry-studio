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
import { loggerService } from '@logger'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const logger = loggerService.withContext('BuiltinAgentProvisioner')

/**
 * Get the path to bundled builtin-agents resources.
 * In dev: resources/builtin-agents/
 * In prod: process.resourcesPath/builtin-agents/
 */
function getBuiltinAgentsResourcePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'builtin-agents')
  }
  // Dev mode: relative to project root
  return path.join(app.getAppPath(), 'resources', 'builtin-agents')
}

const ROLE_TO_TEMPLATE: Record<string, string> = {
  assistant: 'cherry-assistant',
  'skill-creator': 'skill-creator'
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

export interface BuiltinAgentConfig {
  name?: string
  description?: string
  instructions?: string
  configuration?: Record<string, unknown>
}

/**
 * Provision a built-in agent's workspace with template files.
 *
 * Writes .claude/skills/ and .claude/plugins.json to the agent's
 * working directory so the SDK can auto-discover them.
 *
 * @param workspacePath - The agent's working directory (accessible_paths[0])
 * @param builtinRole - The built-in role identifier ('assistant' or 'skill-creator')
 * @returns The parsed agent.json config, or undefined if not found
 */
export async function provisionBuiltinAgent(
  workspacePath: string,
  builtinRole: string
): Promise<BuiltinAgentConfig | undefined> {
  const templateName = ROLE_TO_TEMPLATE[builtinRole]
  if (!templateName) {
    logger.warn('Unknown builtin role, skipping provisioning', { builtinRole })
    return undefined
  }

  const resourceBase = getBuiltinAgentsResourcePath()
  const templateDir = path.join(resourceBase, templateName)

  if (!fs.existsSync(templateDir)) {
    logger.error('Builtin agent template not found', { templateDir, builtinRole })
    return undefined
  }

  try {
    // Copy .claude/ directory (skills + plugins.json)
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

    // Read agent.json to extract full config
    const agentJsonPath = path.join(templateDir, 'agent.json')
    if (fs.existsSync(agentJsonPath)) {
      const agentConfig = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'))
      return {
        name: agentConfig.name,
        description: agentConfig.description,
        instructions: agentConfig.instructions,
        configuration: agentConfig.configuration
      } as BuiltinAgentConfig
    }

    return undefined
  } catch (error) {
    logger.error('Failed to provision builtin agent workspace', {
      builtinRole,
      workspacePath,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

/**
 * Check if a workspace has already been provisioned (has .claude/skills/).
 */
export function isProvisioned(workspacePath: string): boolean {
  return fs.existsSync(path.join(workspacePath, '.claude', 'skills'))
}
