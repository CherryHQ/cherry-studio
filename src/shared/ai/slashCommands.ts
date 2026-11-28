import * as z from 'zod'

export const SlashCommandSchema = z.strictObject({
  command: z.string(),
  description: z.string().optional(),
  subcommands: z.array(z.string()).readonly().optional()
})

export type SlashCommand = z.infer<typeof SlashCommandSchema>
