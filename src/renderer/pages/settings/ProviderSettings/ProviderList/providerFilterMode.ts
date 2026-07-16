/**
 * Sidebar filter modes. The list is flat (no enabled/disabled split), so the
 * filter is also the only knob for hiding disabled providers.
 *
 * - `enabled`: only `isEnabled === true`
 * - `disabled`: only `isEnabled === false`
 * - `all` (default): every provider
 * - `agent`: agent-entry hint; currently shares the `all` provider set because
 *   non-Anthropic chat models route through the local API gateway
 */
export type ProviderFilterMode = 'enabled' | 'disabled' | 'all' | 'agent'
