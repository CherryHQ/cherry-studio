import { recallText } from '../../core/context/recall'
import { recallToolSpec } from '../../core/toolSpecs'
import type { ToolDefinition } from '../../ports/harness'

/** `vcc_recall` (D32): pi-vcc's name and parameters, so existing tool settings and approvals apply; read-only. */
export const recallTool = (): ToolDefinition => ({
  ...recallToolSpec,
  run: async (call, ports) => ({
    text: recallText((await ports.ledger.read(call.thread)).history, call.args),
    isError: false
  })
})
