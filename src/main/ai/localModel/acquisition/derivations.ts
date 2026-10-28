import { parse } from 'yaml'

import type { BundleFileDerivation } from '../catalog/types'

/**
 * Transforms applied to a fetched file before it lands on disk, for the cases where a
 * repo does not publish the artifact a loader actually needs.
 */

/**
 * Build PaddleOCR's on-disk dictionary from the recognition model's `inference.yml`.
 * The `*_onnx` repos ship the dictionary only inside that config (under
 * `PostProcess.character_dict`), not as a standalone file.
 *
 * Format matters: ppu-paddle-ocr reads the dictionary with `split(/\r?\n/)` and no
 * trimming, then its CTC decoder treats index 0 as the blank token and the trailing
 * entry as the space class. So the file must be a leading blank line, the
 * `character_dict` entries, then a trailing newline — which reproduces the dictionary
 * byte-for-byte.
 */
export function dictTextFromInferenceYml(yml: string): string {
  const config = parse(yml) as { PostProcess?: { character_dict?: unknown } } | null
  const characters = config?.PostProcess?.character_dict
  if (!Array.isArray(characters) || characters.length === 0) {
    throw new Error('inference.yml is missing PostProcess.character_dict')
  }
  return `\n${characters.map(String).join('\n')}\n`
}

const DERIVATIONS: Record<BundleFileDerivation, (fetched: string) => string> = {
  paddle_dict_from_inference_yml: dictTextFromInferenceYml
}

export function applyDerivation(derivation: BundleFileDerivation, fetched: string): string {
  return DERIVATIONS[derivation](fetched)
}
