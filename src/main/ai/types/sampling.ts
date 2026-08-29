/**
 * Sampling parameters a request puts on the wire.
 *
 * Deliberately standalone: an assistant carries these among its settings and a
 * feature that keeps its own model configuration (translate) supplies them
 * directly, so neither owns the shape. `AssistantSettings` satisfies it
 * structurally — `buildAgentParams` passing `assistant.settings` is what keeps
 * the two from drifting apart.
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
