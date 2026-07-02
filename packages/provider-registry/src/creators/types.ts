/**
 * Creator registry — the ONLY hand-maintained source for the model catalog.
 *
 * `data/models.json` is generated (see `scripts/generate-catalog.ts`): each creator supplies its model
 * LIST (from its own API and/or hand-written entries), and metadata is enriched from
 * models.dev/OpenRouter. You never edit `models.json` by hand — add/override in a creator here instead.
 */
import type { ModelConfig } from '../schemas/model'

/**
 * A model a creator declares by hand. It is a Partial `ModelConfig` — `ownedBy` comes from the creator and
 * `metadata` is set by the generator, so only `id` is required. Reuses the schema type; nothing is
 * re-declared. Use it to ADD models the API/sources miss (new releases, AIGC, `imageGeneration`
 * widget specs models.dev never has) or to override any field.
 */
export type CreatorModel = Partial<Omit<ModelConfig, 'ownedBy' | 'metadata'>> & { id: string }

export interface Creator {
  /** Canonical creator id — becomes every model's `ownedBy`. Never a host/gateway. */
  id: string
  name: string
  /**
   * Most native source: fetch this creator's list from its OWN `/models` API, parsing its response shape
   * (each creator differs). Reads the creator's key from env; if the key is absent or the call fails, the
   * generator falls back to the models.dev fields below. See `./_api.ts` for shared helpers.
   */
  fetchModels?: () => Promise<CreatorModel[]>
  /** Fallback list source: models.dev provider key(s) whose listing is this creator's catalog. */
  modelsDevProviders?: string[]
  /** Fallback: claim every models.dev/OpenRouter model whose `family` matches (assigns ownedBy). */
  families?: string[]
  /** Fallback: claim every canonical id matching these prefixes. */
  idPrefixes?: string[]
  /**
   * Curated web-search capability as DATA (no `inferXxx`): canonical id-prefixes of THIS creator's models
   * that support web search — a capability upstream (models.dev/OpenRouter) never reports. The generator
   * unions `web-search` onto every owned model matching one of these prefixes (same `prefixHit` semantics
   * as `idPrefixes`). e.g. anthropic `['claude-opus-4', 'claude-sonnet-4']`.
   */
  webSearch?: string[]
  /** Hand-written models — always merged in and winning over the API/sources. */
  models?: CreatorModel[]
  /**
   * Default model kind for creators whose models are all embedders/rerankers but don't say so in their id
   * (`bge-m3`, `voyage-4-lite`, `jina-clip`). The generator tags these with the `embedding`/`rerank`
   * capability — models.dev mislabels them as text. An id containing `rerank` always wins as `rerank`.
   */
  kind?: 'embedding' | 'rerank'
}

export function defineCreator(creator: Creator): Creator {
  return creator
}
