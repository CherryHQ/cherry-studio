import type { ImageOperation } from '@cherrystudio/provider-registry'
import type { PaintingMode } from '@shared/data/types/painting'

/** Historical edit/merge labels describe inputs; only distinct operations survive into requests. */
export function paintingOperation(label: PaintingMode): ImageOperation {
  if (label === 'remix' || label === 'upscale') return label
  return 'generate'
}
