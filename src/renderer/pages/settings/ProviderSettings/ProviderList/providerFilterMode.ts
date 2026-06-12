/**
 * Sidebar filter modes. The list is flat (no enabled/disabled split), so the
 * filter is also the only knob for hiding disabled providers.
 *
 * - `enabled`: only `isEnabled === true`
 * - `disabled`: only `isEnabled === false`
 * - `all` (default): every provider
 * - `agent`: only providers that speak the Anthropic protocol (orthogonal to
 *   the enabled/disabled axis)
 */
export type ProviderFilterMode = 'enabled' | 'disabled' | 'all' | 'agent'
