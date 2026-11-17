import { CircleSlash } from 'lucide-react'

/** Icon for a quick-panel row that stands in for an empty list, so it never reads as a disabled real item. */
export function QuickPanelEmptyIcon() {
  return <CircleSlash size={16} strokeWidth={1.8} aria-hidden className="text-foreground-tertiary" />
}
