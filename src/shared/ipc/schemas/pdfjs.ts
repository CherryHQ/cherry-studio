import * as z from 'zod'

import { defineRoute } from '../define'
import { uint8ArraySchema } from './common'

// Basenames only. The name originates from font tables inside an untrusted PDF,
// and this pattern — no separators, no leading dot — keeps path traversal
// unexpressible at the schema layer already.
const pdfjsResourceNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
  message: 'Resource name must be a basename'
})

/**
 * pdf.js built-in resource IPC — serves the CMaps and standard font files that
 * ship inside the packaged `node_modules/pdfjs-dist` tree (electron-builder
 * keeps `cmaps/` and `standard_fonts/`; they are already in app.asar).
 *
 * The file preview hands these bytes to pdf.js through custom `CMapReaderFactory`
 * / `StandardFontDataFactory` replacements: the packaged renderer loads over
 * `file://`, where fetching asset URLs is blocked, and without the CMaps
 * non-embedded CID-keyed CJK fonts decode to no glyphs at all — Chinese text
 * simply does not render.
 */
export const pdfjsRequestSchemas = {
  'pdfjs.resource.read': defineRoute({
    input: z.strictObject({ kind: z.enum(['cmap', 'standard_font']), name: pdfjsResourceNameSchema }),
    output: z.strictObject({ content: uint8ArraySchema })
  })
}
