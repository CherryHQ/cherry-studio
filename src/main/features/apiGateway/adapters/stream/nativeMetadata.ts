import * as z from 'zod'

const tokenLogprob = z.object({
  token: z.string(),
  logprob: z.number(),
  bytes: z.array(z.number()).nullable().optional(),
  top_logprobs: z.array(
    z.object({
      token: z.string(),
      logprob: z.number(),
      bytes: z.array(z.number()).nullable().optional()
    })
  )
})
const logprobs = z.union([z.array(tokenLogprob), z.array(z.array(tokenLogprob))])

export function readNativeLogprobs(value: unknown): Array<z.infer<typeof tokenLogprob>> | undefined {
  const parsed = logprobs.safeParse(value)
  return parsed.success ? parsed.data.flat() : undefined
}

export const anthropicStopReason = z.enum([
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
  'pause_turn',
  'refusal',
  'model_context_window_exceeded'
])
