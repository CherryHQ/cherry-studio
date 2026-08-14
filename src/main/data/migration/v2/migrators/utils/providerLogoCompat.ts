/**
 * Migration-only compat: recover the v2 icon ref for a v1 built-in provider logo.
 *
 * v1 (`ProviderLogoPicker`) stored a picked built-in logo as `PROVIDER_LOGO_MAP[id]`
 * under `image://provider-<id>` — an *asset* value, NOT an `icon:<id>` ref:
 *   - for logos over vite's 4 KB inline limit, a hashed build-asset URL
 *     (`.../assets/openai-<hash>.png`) whose file no longer exists in v2;
 *   - the literal string `'poe'` (poe used an SVG component, not an asset import).
 * Uploaded logos are base64 `data:` URLs and are handled elsewhere (promoted to a
 * WebP file_entry) — they never reach here.
 *
 * Passing such a value through onto `logoKey` breaks the avatar: `ProviderAvatar`
 * treats a non-`icon:` string as an image URL, and the stale bundle path 404s. So we
 * recover the brand the user picked from the asset filename and re-express it as a v2
 * icon ref (`icon:<catalogKey>`), which the renderer resolves via `resolveProviderIconRef`.
 * An unrecognized value (renamed/removed asset, historical camelCase `icon:` key, a
 * retired provider with no v2 icon) returns null so the caller drops it — the avatar
 * then renders the bundled icon by id (built-in providers) or initials (custom ones),
 * never a broken image.
 *
 * The asset filename stem usually equals a v2 provider-icon catalog key (or one the
 * catalog aliases). {@link STEM_ICON_OVERRIDES} covers the few assets named after a
 * different brand than their icon key. `cephalon` / `tokenflux` are intentionally
 * absent (retired, no v2 icon) so they drop.
 */

/** Recognized v1 provider-logo asset filename stems (lowercased). */
const RECOGNIZED_STEMS: ReadonlySet<string> = new Set([
  '302ai',
  '360',
  'aihubmix',
  'aionly',
  'alayanew',
  'anthropic',
  'aws-bedrock',
  'baichuan',
  'baidu-cloud',
  'bailian',
  'burncloud',
  'cerebras',
  'cherryin',
  'deepseek',
  'dmxapi',
  'fireworks',
  'gitee-ai',
  'github',
  'google',
  'gpustack',
  'grok',
  'groq',
  'huggingface',
  'hunyuan',
  'hyperbolic',
  'infini',
  'intel',
  'jina',
  'lanyun',
  'lmstudio',
  'longcat',
  'microsoft',
  'mimo',
  'minimax',
  'mistral',
  'modelscope',
  'moonshot',
  'newapi',
  'nvidia',
  'ocoolai',
  'ollama',
  'openai',
  'openrouter',
  'perplexity',
  'ph8',
  'poe',
  'ppio',
  'qiniu',
  'silicon',
  'sophnet',
  'step',
  'tencent-cloud-ti',
  'together',
  'vercel',
  'vertexai',
  'volcengine',
  'voyageai',
  'xirang',
  'zai',
  'zero-one',
  'zhipu'
])

/**
 * Asset stems whose brand maps to a differently-named v2 icon catalog key. Stems not
 * listed are used verbatim (they equal a catalog key or one `resolveProviderIconRef`
 * aliases). Values must exist in `PROVIDER_ICON_META_CATALOG` (or as a model icon).
 */
const STEM_ICON_OVERRIDES: Record<string, string> = {
  '360': 'xirang', // ZhinaoProviderLogo = 360.png; v2 aliases zhinao → xirang
  aionly: 'ai-only', // AiOnlyProviderLogo = aiOnly.webp
  microsoft: 'azureai', // AzureProviderLogo = microsoft.png
  voyageai: 'voyage', // VoyageAIProviderLogo = voyageai.png
  zai: 'z-ai' // ZaiAppLogo = zai.svg
}

/** Match a filename stem to a recognized asset, tolerating a vite `-<hash>` suffix. */
function matchStem(name: string): string | null {
  const lower = name.toLowerCase()
  if (RECOGNIZED_STEMS.has(lower)) return lower
  // Bundled assets are `<stem>-<contenthash>`; the hash charset is unknown, so match
  // by known prefix rather than trying to strip it (no stem is a prefix of another).
  for (const stem of RECOGNIZED_STEMS) {
    if (lower.startsWith(`${stem}-`)) return stem
  }
  return null
}

/**
 * Given a v1 `image://provider-*` value (build-asset URL, literal id, or historical
 * `icon:<id>`), return the v2 `icon:<catalogKey>` logo key, or null if unrecognized.
 */
export function recoverV1ProviderLogoIconKey(stored: string): string | null {
  const trimmed = stored.trim()
  if (!trimmed) return null

  const raw = trimmed.startsWith('icon:')
    ? trimmed.slice('icon:'.length)
    : (trimmed.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '')

  const stem = matchStem(raw)
  if (!stem) return null

  return `icon:${STEM_ICON_OVERRIDES[stem] ?? stem}`
}
