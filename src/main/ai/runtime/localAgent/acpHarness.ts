import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'
import { legacyCursorAcpAdapter } from '@cherrystudio/agent-runtime-cursor/legacy-acp'
import { grokAcpAdapter } from '@cherrystudio/agent-runtime-grok-acp'
import { piAcpAdapter } from '@cherrystudio/agent-runtime-pi-acp'

const custom: AcpHarnessAdapter = {
  register(app, host) {
    legacyCursorAcpAdapter.register(app, host)
    grokAcpAdapter.register(app, host)
  }
}

export function localAcpHarness(presetId?: string): AcpHarnessAdapter | undefined {
  switch (presetId) {
    case 'pi-acp':
      return piAcpAdapter
    case 'grok-build':
      return grokAcpAdapter
    case 'cursor':
      return legacyCursorAcpAdapter
    case 'custom':
    case undefined:
      return custom
    default:
      return undefined
  }
}
