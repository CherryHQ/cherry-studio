import type { CodeToolMeta } from './types'

export function CliIconBadge({ tool, size = 44 }: { tool: CodeToolMeta; size?: number }) {
  const radius = Math.round(size * 0.25)
  if (tool.icon) {
    const Icon = tool.icon
    return (
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden"
        style={{ width: size, height: size, borderRadius: radius }}>
        <Icon width={size} height={size} aria-label={tool.label} />
      </div>
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center bg-muted font-semibold text-muted-foreground"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.34),
        lineHeight: 1
      }}>
      {tool.label.charAt(0)}
    </div>
  )
}
