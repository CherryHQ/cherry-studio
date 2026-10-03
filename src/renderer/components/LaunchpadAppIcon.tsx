import { cn } from '@renderer/utils/style'

export function LaunchpadAppIcon({ src, size = 50, className }: { src: string; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-2xl border border-border-subtle bg-transparent transition-[border-color,background-color] duration-[160ms] ease-in-out group-hover:bg-accent group-focus-visible:border-ring group-focus-visible:bg-accent motion-reduce:transition-none',
        className
      )}
      style={{ width: size + 6, height: size + 6 }}>
      <span
        className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl select-none"
        style={{ width: size, height: size }}>
        <img src={src} alt="" className="size-full object-contain" draggable={false} />
      </span>
    </span>
  )
}
