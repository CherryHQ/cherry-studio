import { goalCommandDescriptor } from '@cherrystudio/agent-behavior'
import type { RuntimeCommand } from '@cherrystudio/agent-runtime'

export const piBuiltinCommands = [
  {
    name: 'compact',
    description: 'Compact conversation with optional focus instructions',
    argumentHint: '',
    builtin: true
  },
  goalCommandDescriptor
] as const satisfies readonly RuntimeCommand[]
