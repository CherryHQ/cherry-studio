import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * OVMS (OpenVINO Model Server) IPC schemas. `is_supported` (a pure platform predicate)
 * and `install_binary` (installs the binary before the service exists) run on every
 * platform; the five operation routes are backed by the `@Conditional` OvmsManager and
 * throw OVMS_NOT_AVAILABLE off Win32+Intel (see handlers/ovms.ts + errors/ovms.ts).
 */
const opResult = z.object({ success: z.boolean(), message: z.string().optional() })

export const ovmsRequestSchemas = {
  'ovms.is_supported': defineRoute({ input: z.void(), output: z.boolean() }),
  'ovms.install_binary': defineRoute({ input: z.void(), output: z.void() }),
  'ovms.add_model': defineRoute({
    input: z.object({
      modelName: z.string(),
      modelId: z.string(),
      modelSource: z.string(),
      task: z.string()
    }),
    output: opResult
  }),
  // Fire-and-forget: the sole caller treats cancel as complete regardless of the result.
  'ovms.cancel_add_model': defineRoute({ input: z.void(), output: z.void() }),
  'ovms.get_status': defineRoute({ input: z.void(), output: z.enum(['not-installed', 'not-running', 'running']) }),
  // start/stop throw OVMS_START_FAILED / OVMS_STOP_FAILED (carrying the manager's message) on
  // failure so the renderer's try/catch toasts it; a resolved void means success.
  'ovms.start': defineRoute({ input: z.void(), output: z.void() }),
  'ovms.stop': defineRoute({ input: z.void(), output: z.void() })
}
