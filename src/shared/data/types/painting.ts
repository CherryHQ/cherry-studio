/**
 * TRANSITION SHIM — paintings are now `creation` rows with `kind: 'image'`.
 *
 * The legacy paintings page still imports `Painting` / `PaintingMode` / etc.;
 * these re-export the unified `creation` types so that page compiles unchanged.
 * Removed when the page is rewritten as the unified Creation page (Phase 5).
 */

import type { Creation, CreationFiles, CreationMode } from './creation'
import { CreationFilesSchema, CreationModeSchema } from './creation'

export const PaintingModeSchema = CreationModeSchema
export type PaintingMode = CreationMode

export const PaintingFilesSchema = CreationFilesSchema
export type PaintingFiles = CreationFiles

/** A painting is a `creation` with `kind: 'image'`; the extra `kind` field is ignored by the legacy page. */
export type Painting = Creation
