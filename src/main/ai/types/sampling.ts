/**
 * Sampling parameters a request asks for, before model-capability gating decides
 * which of them actually reach the wire.
 *
 * Deliberately standalone: an assistant carries these among its settings and a
 * feature that keeps its own model configuration (translate) supplies them
 * directly, so neither owns the shape. Both bind to it structurally —
 * `buildAgentParams` passes `assistant.settings`, `translateService` builds a
 * literal with `satisfies SamplingSettings` — and those two bindings are what
 * keep the shapes from drifting apart.
 *
 * Each value is paired with an `enable*` flag. When the flag is off the value is
 * not sent and the model's own default applies.
 *
 * Keeping the flag separate from the value is deliberate, not redundancy:
 * turning a parameter off preserves the number the user picked, so switching it
 * back on restores that choice instead of a fresh default. Collapsing the pair
 * into one nullable field would overwrite the stored value on every toggle.
 */
export interface SamplingSettings {
  temperature: number
  enableTemperature: boolean
  topP: number
  enableTopP: boolean
  maxTokens: number
  enableMaxTokens: boolean
}
