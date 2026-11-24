import { type ReactNode, useState } from 'react'

export function AssistantAvatarImage({
  src,
  fallback,
  alt,
  className,
  size
}: {
  src?: string
  fallback: ReactNode
  alt: string
  className?: string
  size?: number
}) {
  const [failedSrc, setFailedSrc] = useState<string>()
  return src && src !== failedSrc ? (
    <img
      src={src}
      alt={alt}
      className={className}
      style={size ? { width: size, height: size } : undefined}
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <>{fallback}</>
  )
}
