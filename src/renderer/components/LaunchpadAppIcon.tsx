import { cn } from '@renderer/utils/style'

export function LaunchpadAppIcon({ src, size = 56, className }: { src: string; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-2xl bg-muted group-focus-visible:inset-ring-2 group-focus-visible:inset-ring-ring',
        className
      )}
      style={{ width: size, height: size }}>
      <span
        className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[inherit] [color-scheme:light] dark:[color-scheme:dark] select-none"
        style={{ width: size, height: size }}>
        <img src={src} alt="" className="size-full object-contain" draggable={false} />
      </span>
    </span>
  )
}
