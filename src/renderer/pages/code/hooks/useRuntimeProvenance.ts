import { useEffect, useState } from 'react'

import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { CodeCli } from '@shared/types/codeCli'
import type { RuntimeProvenance, RuntimeProvenanceTool } from '@shared/types/runtimeProvenance'

const logger = loggerService.withContext('useRuntimeProvenance')

const PROVENANCE_TOOL: Partial<Record<CodeCli, RuntimeProvenanceTool>> = {
  [CodeCli.HERMES]: 'hermes',
  [CodeCli.DEEPSEEK_HARNESS]: 'dsh'
}

/**
 * Loads the runtime provenance for tools whose local runtime reads a Cherry-owned
 * config home. `revision` re-reads it when the binary state changes.
 */
export function useRuntimeProvenance(tool: CodeCli, revision: string): RuntimeProvenance | undefined {
  const provenanceTool = PROVENANCE_TOOL[tool]
  const [provenance, setProvenance] = useState<RuntimeProvenance | undefined>(undefined)

  useEffect(() => {
    if (!provenanceTool) {
      setProvenance(undefined)
      return
    }
    let cancelled = false
    void ipcApi
      .request('runtime_provenance.get', provenanceTool)
      .then((result) => {
        if (!cancelled) setProvenance(result)
      })
      .catch((error) => {
        logger.error('Failed to read runtime provenance', error as Error)
        if (!cancelled) setProvenance(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [provenanceTool, revision])

  return provenance
}
