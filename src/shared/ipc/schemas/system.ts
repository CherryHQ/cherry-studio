import * as z from 'zod'

import { defineRoute } from '../define'

// ── Request: renderer→main system capability calls (zod values, always parsed) ──
export const systemRequestSchemas = {
  'system.get_device_type': defineRoute({ input: z.void(), output: z.string() }),
  'system.get_hostname': defineRoute({ input: z.void(), output: z.string() }),
  'system.get_cpu_name': defineRoute({ input: z.void(), output: z.string() }),
  'system.get_fonts': defineRoute({ input: z.void(), output: z.array(z.string()) }),
  'system.is_process_trusted': defineRoute({ input: z.void(), output: z.boolean() }),
  'system.request_process_trust': defineRoute({ input: z.void(), output: z.boolean() })
}
