import type { BinaryAvailability } from './binary'

/**
 * Which Cherry-managed runtime a provenance snapshot describes. Hermes covers the
 * Hermes CodeMate launcher and Dashboard; DSH covers the DSH CodeMate web process.
 */
export type RuntimeProvenanceTool = 'hermes' | 'dsh'

/** Main-computed facts about the runtime Cherry would actually run for a tool. */
export type RuntimeProvenance = {
  tool: RuntimeProvenanceTool
  binarySource: BinaryAvailability['source']
  /** Resolved executable; absent when no runnable binary is available. */
  executablePath?: string
  /** Version reported by BinaryManager; absent for a system binary, which is not probed. */
  version?: string
  /** Config home the runtime reads and that Cherry writes to. */
  configHome: string
  /** User plugin directories, or null when runtime-specific discovery is not known. */
  pluginRoots: string[] | null
  /** DSH reload behavior depends on the edit and runtime version (including HMR). */
  reloadRequirement: 'restart_session' | 'runtime_dependent'
}
