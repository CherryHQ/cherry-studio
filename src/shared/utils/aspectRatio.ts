/**
 * Canonical aspect-ratio syntax shared by the renderer (picker / chip labels) and
 * the main-process request path (`normalizeAspectRatio` in `aiSdkNativeBindings`).
 * Kept in `@shared` so the two layers can never drift: the picker must accept
 * exactly the values the execution path will deliver.
 *
 * Normalize the painting form's `ASPECT_X_Y` enum (or already-normalized `X:Y`)
 * into the `${number}:${number}` shape the AI SDK image option + Google/Imagen
 * accept. Returns `undefined` for blank / mismatched values so the field is
 * omitted. Idempotent (`X:Y → X:Y`), so emitters may re-apply it safely.
 */
export function normalizeAspectRatio(value: string | undefined): string | undefined {
  if (!value) return undefined
  const stripped = value.replace(/^ASPECT_/i, '').replace('_', ':')
  return /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(stripped) ? stripped : undefined
}
