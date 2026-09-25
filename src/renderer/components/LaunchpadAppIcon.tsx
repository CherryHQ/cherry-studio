export function LaunchpadAppIcon({ src, size = 50 }: { src: string; size?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-2xl border border-border-subtle bg-transparent"
      style={{ width: size + 6, height: size + 6 }}>
      <span
        className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl select-none"
        style={{ width: size, height: size }}>
        <img src={src} alt="" className="size-full object-contain" draggable={false} />
      </span>
    </span>
  )
}
