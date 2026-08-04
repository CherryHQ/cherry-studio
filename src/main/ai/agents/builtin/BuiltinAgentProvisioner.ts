/**
 * BuiltinAgentProvisioner
 *
 * Loads built-in agent definitions and initializes persona/memory files in
 * persistent agent data directories. Bundled skills stay in the read-only app
 * resources directory and are injected as a local Claude plugin.
 */
import { loggerService } from '@logger'
import { toAsarUnpackedPath } from '@main/utils/asar'
import fs from 'fs'
import path from 'path'

import {
  type BuiltinAgentDefinition,
  getBuiltinAgentTemplateDirectory,
  loadBuiltinAgentDefinition
} from './BuiltinAgentDefinition'

const logger = loggerService.withContext('BuiltinAgentProvisioner')

export function getBuiltinAgentPluginDirectory(builtinRole: string): string | undefined {
  const templateDir = getBuiltinAgentTemplateDirectory(builtinRole)
  if (!templateDir) return undefined

  // Claude Code runs out of process and cannot resolve Electron's virtual app.asar paths.
  const pluginDirectory = toAsarUnpackedPath(path.join(templateDir, '.claude'))
  const manifestPath = path.join(pluginDirectory, '.claude-plugin', 'plugin.json')
  if (!fs.existsSync(manifestPath)) {
    logger.error('Builtin agent plugin manifest not found', { builtinRole, manifestPath })
    return undefined
  }

  return pluginDirectory
}

/**
 * Recursively copy files that do not already exist, creating target dirs as needed.
 */
function copyMissingDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyMissingDirSync(srcPath, destPath)
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export { loadBuiltinAgentDefinition } from './BuiltinAgentDefinition'

/**
 * Initialize a built-in agent's persistent data directory.
 *
 * Session workspaces remain independent project directories and are never
 * modified by this function. Bundled skills are loaded from the app-owned plugin directory.
 *
 * @param agentDataPath - The agent's persistent identity and memory directory
 * @param builtinRole - The built-in role identifier (currently only 'assistant')
 * @returns The parsed agent.json config, or undefined if not found
 */
export async function provisionBuiltinAgent(
  agentDataPath: string,
  builtinRole: string
): Promise<BuiltinAgentDefinition | undefined> {
  const templateDir = getBuiltinAgentTemplateDirectory(builtinRole)
  if (!templateDir) return undefined

  if (!fs.existsSync(templateDir)) {
    logger.error('Builtin agent template not found', { templateDir, builtinRole })
    return undefined
  }

  const definition = loadBuiltinAgentDefinition(builtinRole)
  if (!definition) return undefined

  try {
    // Populate missing or zero-byte persona placeholders on first provision.
    // Never overwrite non-empty files — the user may have customized their persona.
    for (const soulFile of ['SOUL.md', 'USER.md']) {
      const srcFile = path.join(templateDir, soulFile)
      const destFile = path.join(agentDataPath, soulFile)
      const destStat = fs.existsSync(destFile) ? fs.lstatSync(destFile) : undefined
      const shouldInitialize = !destStat || (destStat.isFile() && destStat.size === 0)
      if (fs.existsSync(srcFile) && shouldInitialize) {
        fs.copyFileSync(srcFile, destFile)
      }
    }

    const srcMemoryDir = path.join(templateDir, 'memory')
    const destMemoryDir = path.join(agentDataPath, 'memory')
    if (fs.existsSync(srcMemoryDir)) {
      copyMissingDirSync(srcMemoryDir, destMemoryDir)
    }

    return definition
  } catch (error) {
    logger.error('Failed to provision builtin agent data', {
      builtinRole,
      agentDataPath,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}
