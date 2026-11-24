// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Historical configs and partial drafts are unparsed; only an actual string belongs in a text or credential input.
export function readChannelText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Channel ID arrays can contain malformed historical entries; retain valid strings in order without trimming or deduplicating them.
export function readChannelIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Mention-only is an optional stored field; preserve explicit false and use the existing default for missing or malformed values.
export function readMentionOnly(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true
}
