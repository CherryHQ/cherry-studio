import * as z from 'zod'

import { documentArtifactSchema, documentFormatSchema } from '@shared/types/documentConversion'

import { defineRoute } from '../define'

/**
 * Export IPC schemas — document/vault export actions, grouped by target: `export.word.*`
 * (Word export) and `export.obsidian.*` (Obsidian vault discovery for the Obsidian export
 * flow). All are request-only; the handlers delegate to the non-lifecycle
 * ExportService / ObsidianVaultService singletons.
 */
export const exportRequestSchemas = {
  'export.document.convert_and_save': defineRoute({
    input: z
      .object({
        markdown: z.string().optional(),
        filePath: z.string().optional(),
        draft: z.string().optional(),
        format: documentFormatSchema,
        defaultName: z.string(),
        sourcePath: z.string().optional(),
        assetRoot: z.string().optional()
      })
      .refine(
        (input) => (input.markdown !== undefined) !== (input.filePath !== undefined),
        'Provide exactly one source'
      ),
    output: documentArtifactSchema.nullable()
  }),
  'export.word.from_markdown': defineRoute({
    input: z.object({ markdown: z.string(), fileName: z.string() }),
    output: z.boolean()
  }),
  'export.obsidian.get_vaults': defineRoute({
    input: z.void(),
    output: z.array(z.object({ path: z.string(), name: z.string() }))
  }),
  'export.obsidian.get_files': defineRoute({
    input: z.object({ vaultName: z.string() }),
    output: z.array(z.object({ path: z.string(), type: z.enum(['folder', 'markdown']), name: z.string() }))
  })
}
