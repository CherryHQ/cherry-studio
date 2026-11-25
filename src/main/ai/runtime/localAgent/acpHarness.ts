import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'
import { grokAcpAdapter } from '@cherrystudio/agent-runtime-grok-acp'
import { piAcpAdapter } from '@cherrystudio/agent-runtime-pi-acp'

export function localAcpHarness(presetId?: string): AcpHarnessAdapter | undefined {
  switch (presetId) {
    case 'pi-acp':
      return piAcpAdapter
    case 'grok-build':
    case 'custom':
    case undefined:
      return grokAcpAdapter
    default:
      return undefined
  }
}
