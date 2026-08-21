import * as z from 'zod'

/** Maximum normalized 128×128 icon payload accepted over IPC. */
export const MAX_ICON_IMAGE_BYTES = 1024 * 1024

/** Non-empty normalized avatar/logo bytes within the IPC size cap. */
export const IconImageBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_ICON_IMAGE_BYTES, 'icon image bytes out of range')
