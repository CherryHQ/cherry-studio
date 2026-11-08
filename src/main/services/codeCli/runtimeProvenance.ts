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
    pluginRoots: [configHome],
    reloadRequirement: 'restart_session'
  }
}
