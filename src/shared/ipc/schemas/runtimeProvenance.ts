import * as z from 'zod'

import { defineRoute } from '../define'

const runtimeProvenanceSchema = z.object({
  tool: z.enum(['hermes', 'dsh']),
  binarySource: z.enum(['mise', 'bundled', 'system', 'none']),
  executablePath: z.string().optional(),
  version: z.string().optional(),
  configHome: z.string(),
  pluginRoots: z.array(z.string()),
  reloadRequirement: z.literal('restart_session')
})

export const runtimeProvenanceRequestSchemas = {
  'runtime_provenance.get': defineRoute({
    input: z.enum(['hermes', 'dsh']),
    output: runtimeProvenanceSchema
  })
}
