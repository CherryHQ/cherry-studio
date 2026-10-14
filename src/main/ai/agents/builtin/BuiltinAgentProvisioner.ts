import fs from 'fs'
/**
 * BuiltinAgentProvisioner
 *
 * Loads built-in agent definitions and initializes persona/memory files in
 * persistent agent data directories. Bundled skills stay in the read-only app
 * resources directory and are injected as a local Claude plugin.
 */
import { createHash } from 'node:crypto'
import path from 'path'

import { loggerService } from '@logger'
import { toAsarUnpackedPath } from '@main/utils/asar'

import {
  type BuiltinAgentDefinition,
  getBuiltinAgentPluginTemplateDirectory,
  getBuiltinAgentTemplateDirectory,
  loadBuiltinAgentDefinition
} from './builtinAgentDefinition'

const logger = loggerService.withContext('BuiltinAgentProvisioner')

/**
 * SHA-256 hashes of Cherry Assistant SOUL.md revisions that must be upgraded.
 * These earlier revisions baked identity/role text into the persona file; the
 * current bundle keeps SOUL.md to personality/tone only. Because provisioning
 * never overwrites a non-empty SOUL.md, installs made against these revisions
 * would otherwise keep the stale stock persona forever. The migration below
 * replaces a SOUL.md ONLY when its exact bytes match one of these known stock
 * blobs — any user edit changes the hash and is preserved untouched.
 *
 * Add a new hash here only when a bundled revision contains product-owned role
 * or policy that must not remain in the user-owned persona file. Compute with:
 *   `shasum -a 256 resources/builtin-agents/cherry-assistant/SOUL.md`
 */
const LEGACY_STOCK_SOUL_SHA256_BY_SIZE: ReadonlyMap<number, ReadonlySet<string>> = new Map([
  // v2.0.0-rc.5 — restrictive "identity/grounding/working-principles" persona.
  [3600, new Set(['61ad24c3bb6bb1032c3664e847988b0f13a429a3d0e5d5048c74a65f6b35faa9'])],
  // Interim "restore normal agent capabilities" persona (PR #17870, pre-release).
  [321, new Set(['6aeb1da6822e43670bed8a683ecc22194a1517b9c377988c1f77d48d872618e8'])]
])

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function getBuiltinAgentPluginDirectory(builtinRole: string): string | undefined {
  const templateDir = getBuiltinAgentPluginTemplateDirectory(builtinRole)
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

export { loadBuiltinAgentDefinition } from './builtinAgentDefinition'

/**
 * Initialize a built-in agent's persistent data directory.
 *
 * Session workspaces remain independent project directories and are never
 * modified by this function. Bundled skills are loaded from the app-owned plugin directory.
 *
 * @param agentDataPath - The agent's persistent identity and memory directory
 * @param builtinRole - The built-in role identifier
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
    // Never overwrite a non-empty file — the user may have customized their persona.
    // SOUL.md additionally migrates known stale stock content (see below); any other
    // non-empty content is treated as user-owned and left intact.
    for (const soulFile of ['SOUL.md', 'USER.md']) {
      const srcFile = path.join(templateDir, soulFile)
      const destFile = path.join(agentDataPath, soulFile)
      if (!fs.existsSync(srcFile)) continue

      const destStat = fs.existsSync(destFile) ? fs.lstatSync(destFile) : undefined
      const shouldInitialize = !destStat || (destStat.isFile() && destStat.size === 0)
      if (shouldInitialize) {
        fs.copyFileSync(srcFile, destFile)
        continue
      }

      // Surgical stock migration (SOUL.md only): replace a non-empty SOUL.md whose exact
      // bytes match a historical bundled blob. A user edit changes the hash, so customized
      // souls are never touched.
      if (soulFile === 'SOUL.md' && destStat?.isFile() && !destStat.isSymbolicLink()) {
        // SOUL.md is user-editable and may be large. Check the exact stock byte size before
        // reading it so normal/custom personas do not pay a synchronous full-file hash per build.
        const candidateHashes = LEGACY_STOCK_SOUL_SHA256_BY_SIZE.get(destStat.size)
        const destHash = candidateHashes ? sha256(fs.readFileSync(destFile)) : undefined
        if (destHash && candidateHashes?.has(destHash)) {
          fs.copyFileSync(srcFile, destFile)
          logger.info('Migrated stale bundled SOUL.md to the current stock persona', { agentDataPath, destHash })
        }
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
