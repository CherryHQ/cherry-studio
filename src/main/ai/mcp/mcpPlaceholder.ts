const UNRESOLVED_CONFIG_PLACEHOLDER = /\$\{[A-Za-z_][A-Za-z0-9_.]*\}|%[A-Za-z_][A-Za-z0-9_]*%|^YOUR_[A-Z0-9_]+$/

export function containsUnresolvedConfigPlaceholder(value: string): boolean {
  return UNRESOLVED_CONFIG_PLACEHOLDER.test(value.trim())
}
