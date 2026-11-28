import path from 'node:path'

import { application } from '@application'
import type { RuntimeProvenance, RuntimeProvenanceTool } from '@shared/types/runtimeProvenance'

import { getHermesHome } from './hermesHome'

const BINARY_NAMES: Record<RuntimeProvenanceTool, string> = {
  hermes: 'hermes',
  dsh: 'dsh'
}

/**
 * Describes the runtime Cherry runs for a tool: which binary source won, where it
 * lives, and which config home and plugin roots it reads. Mirrors the env each
 * launcher sets (HERMES_HOME for Hermes, DSH_HOME for DSH CodeMate).
 */
export async function getRuntimeProvenance(tool: RuntimeProvenanceTool): Promise<RuntimeProvenance> {
  const snapshot = (await application.get('BinaryManager').getToolSnapshots([BINARY_NAMES[tool]]))[BINARY_NAMES[tool]]
  const availability = snapshot.availability
  const configHome = tool === 'hermes' ? await getHermesHome() : application.getPath('external.deepseek_harness.config')
  const version = availability.source === 'mise' || availability.source === 'bundled' ? availability.version : undefined

  return {
    tool,
    binarySource: availability.source,
    ...(availability.source !== 'none' ? { executablePath: availability.path } : {}),
    ...(version ? { version } : {}),
    configHome,
    // Hermes documents user plugins beneath its home. DSH packages depend on
    // the installation/profile, so the config home is not a verified plugin root.
    pluginRoots: tool === 'hermes' ? [path.join(configHome, 'plugins')] : null,
    reloadRequirement: tool === 'hermes' ? 'restart_session' : 'runtime_dependent'
  }
}
