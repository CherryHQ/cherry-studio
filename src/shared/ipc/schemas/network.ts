import type { EndpointDiagnosis } from '@shared/types/network'
import * as z from 'zod'

import { defineRoute } from '../define'

export const networkRequestSchemas = {
  /** Layered reachability of one URL; online state itself is on the shared cache key `network.online`. */
  'network.diagnose_endpoint': defineRoute({
    input: z.object({ url: z.string().url() }).strict(),
    output: z.custom<EndpointDiagnosis>()
  })
}
