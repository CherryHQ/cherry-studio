import type { LucideIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { createContext, type ReactNode, use } from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

/** Index into the `illustration-*` palette; only empty-state scenes may use it (see DESIGN.md). */
export type IllustrationColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export type EmptyStateSceneSize = 'page' | 'panel' | 'sidebar'

export type SceneSpriteShape = 'checker' | 'corner' | 'cross' | 'bug' | 'ring'

/** One pixel sprite on the slice edge, positioned in scene pixels. */
export interface SceneSprite {
  x: number
  y: number
  color: IllustrationColor
  shape: SceneSpriteShape
  tilt?: number
}

const SCENE_SIZE: Record<EmptyStateSceneSize, { width: number; height: number }> = {
  page: { width: 312, height: 208 },
  panel: { width: 260, height: 176 },
  sidebar: { width: 188, height: 138 }
}

// Full class strings so Tailwind can see every palette utility.
const ACCENT = {
  1: {
    text: 'text-illustration-1',
    bg: 'bg-illustration-1',
    border: 'border-illustration-1',
    tint: 'bg-illustration-1/10',
    ring: 'ring-illustration-1/25'
  },
  2: {
    text: 'text-illustration-2',
    bg: 'bg-illustration-2',
    border: 'border-illustration-2',
    tint: 'bg-illustration-2/10',
    ring: 'ring-illustration-2/25'
  },
  3: {
    text: 'text-illustration-3',
    bg: 'bg-illustration-3',
    border: 'border-illustration-3',
    tint: 'bg-illustration-3/10',
    ring: 'ring-illustration-3/25'
  },
  4: {
    text: 'text-illustration-4',
    bg: 'bg-illustration-4',
    border: 'border-illustration-4',
    tint: 'bg-illustration-4/10',
    ring: 'ring-illustration-4/25'
  },
  5: {
    text: 'text-illustration-5',
    bg: 'bg-illustration-5',
    border: 'border-illustration-5',
    tint: 'bg-illustration-5/10',
    ring: 'ring-illustration-5/25'
  },
  6: {
    text: 'text-illustration-6',
    bg: 'bg-illustration-6',
    border: 'border-illustration-6',
    tint: 'bg-illustration-6/10',
    ring: 'ring-illustration-6/25'
  },
  7: {
    text: 'text-illustration-7',
    bg: 'bg-illustration-7',
    border: 'border-illustration-7',
    tint: 'bg-illustration-7/10',
    ring: 'ring-illustration-7/25'
  },
  8: {
    text: 'text-illustration-8',
    bg: 'bg-illustration-8',
    border: 'border-illustration-8',
    tint: 'bg-illustration-8/10',
    ring: 'ring-illustration-8/25'
  }
} satisfies Record<IllustrationColor, Record<'text' | 'bg' | 'border' | 'tint' | 'ring', string>>

const AccentContext = createContext(ACCENT[1])
const useAccent = () => use(AccentContext)

const SPRITE_PATTERNS: Record<SceneSpriteShape, string[]> = {
  checker: ['0101', '1010', '0101', '1010'],
  corner: ['1111', '1000', '1000', '0011'],
  cross: ['1001', '0110', '0110', '1001'],
  bug: ['01010', '11111', '01010', '10101'],
  ring: ['0110', '1001', '1001', '0110']
}
const SPRITE_CELL = 3.9

function Sprite({ sprite, index }: { sprite: SceneSprite; index: number }) {
  const reduceMotion = useReducedMotion()
  const rows = SPRITE_PATTERNS[sprite.shape]
  const width = rows[0].length * SPRITE_CELL
  const height = rows.length * SPRITE_CELL
  return (
    <motion.svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('absolute fill-current', ACCENT[sprite.color].text)}
      style={{ left: sprite.x, top: sprite.y, rotate: sprite.tilt ?? 0 }}
      animate={
        reduceMotion
          ? undefined
          : { y: [0, -6, 0], rotate: [sprite.tilt ?? 0, (sprite.tilt ?? 0) + 10, sprite.tilt ?? 0] }
      }
      transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay: index * 0.7 }}>
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === '1' ? (
            <rect key={`${x}-${y}`} x={x * SPRITE_CELL} y={y * SPRITE_CELL} width={SPRITE_CELL} height={SPRITE_CELL} />
          ) : null
        )
      )}
    </motion.svg>
  )
}

export interface EmptyStateSceneProps {
  size?: EmptyStateSceneSize
  /** Palette index of the scene's single accent: the element that marks the next step. */
  accent: IllustrationColor
  sprites?: readonly SceneSprite[]
  /** Slice content, positioned in scene pixels. */
  children: ReactNode
  className?: string
}

/**
 * Decorative frame for an empty-state scene: a cropped slice of real UI that fades into its container.
 * It is hidden from assistive technology; the surrounding EmptyState carries the accessible copy.
 */
export function EmptyStateScene({ size = 'page', accent, sprites = [], children, className }: EmptyStateSceneProps) {
  const { width, height } = SCENE_SIZE[size]
  return (
    <AccentContext value={ACCENT[accent]}>
      <div
        aria-hidden="true"
        inert
        data-slot="empty-state-scene"
        className={cn('pointer-events-none relative shrink-0 select-none', className)}
        style={{ width, height }}>
        <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_80%_80%_at_50%_20%,black_55%,transparent)]">
          {children}
        </div>
        {sprites.map((sprite, index) => (
          <Sprite key={index} sprite={sprite} index={index} />
        ))}
      </div>
    </AccentContext>
  )
}

/** Top-lit surface of the slice: a window, panel, menu or card. Position and size it with `className`. */
export function ScenePanel({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-[12px] border border-border border-t-border-strong bg-card text-[8px] shadow-lg',
        className
      )}>
      {children}
    </div>
  )
}

export function SceneHeader({
  icon: Icon,
  title,
  trailing,
  className
}: {
  icon?: LucideIcon
  title?: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-[34px] shrink-0 items-center gap-[6px] border-b border-border-subtle px-[13px]',
        className
      )}>
      {Icon && <Icon size={12} strokeWidth={1.8} className="shrink-0 text-foreground" />}
      {title && <span className="truncate text-[9px] font-semibold text-foreground">{title}</span>}
      {trailing && <span className="ml-auto flex shrink-0 items-center gap-[6px]">{trailing}</span>}
    </div>
  )
}

export function SceneRow({
  icon: Icon,
  label,
  meta,
  selected = false,
  muted = false,
  className
}: {
  icon?: LucideIcon
  label: ReactNode
  meta?: ReactNode
  /** Accent highlight: the row the cursor is about to pick. */
  selected?: boolean
  muted?: boolean
  className?: string
}) {
  const accent = useAccent()
  return (
    <div
      className={cn(
        'flex h-[18px] shrink-0 items-center gap-[6px] rounded-[5px] px-[7px] text-[7.5px]',
        selected ? cn(accent.tint, 'text-foreground') : muted ? 'text-foreground-tertiary' : 'text-muted-foreground',
        className
      )}>
      {Icon && <Icon size={10} strokeWidth={1.9} className="shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
      {meta && <span className="ml-auto shrink-0 text-[6.5px] text-foreground-tertiary">{meta}</span>}
    </div>
  )
}

export function SceneInput({
  icon: Icon,
  value,
  placeholder,
  focused = false,
  caret = false,
  className
}: {
  icon?: LucideIcon
  value?: ReactNode
  placeholder?: ReactNode
  /** Accent focus ring: the field the user types into next. */
  focused?: boolean
  caret?: boolean
  className?: string
}) {
  const accent = useAccent()
  return (
    <div
      className={cn(
        'flex h-[18px] shrink-0 items-center gap-[4px] rounded-[6px] border bg-muted px-[6px] text-[7.5px]',
        focused ? cn(accent.border, 'ring-2', accent.ring) : 'border-border-subtle',
        className
      )}>
      {Icon && <Icon size={9} strokeWidth={2} className="shrink-0 text-foreground-tertiary" />}
      {value && <span className="truncate text-foreground">{value}</span>}
      {caret && <SceneCaret accent={focused} />}
      {placeholder && <span className="truncate text-foreground-tertiary">{placeholder}</span>}
    </div>
  )
}

export function SceneButton({
  icon: Icon,
  label,
  accent: isAccent = false,
  className
}: {
  icon?: LucideIcon
  label: ReactNode
  accent?: boolean
  className?: string
}) {
  const accent = useAccent()
  return (
    <span
      className={cn(
        'inline-flex h-[17px] shrink-0 items-center gap-[4px] rounded-[5px] border px-[7px] text-[7.3px] font-medium whitespace-nowrap',
        isAccent ? cn(accent.border, accent.tint, accent.text) : 'border-border bg-card text-muted-foreground',
        className
      )}>
      {Icon && <Icon size={9} strokeWidth={2.2} />}
      {label}
    </span>
  )
}

export function SceneChip({
  icon: Icon,
  label,
  accent: isAccent = false,
  className
}: {
  icon?: LucideIcon
  label: ReactNode
  accent?: boolean
  className?: string
}) {
  const accent = useAccent()
  return (
    <span
      className={cn(
        'inline-flex h-[14px] shrink-0 items-center gap-[3px] rounded-full px-[6px] text-[6.8px] font-medium whitespace-nowrap',
        isAccent ? cn(accent.tint, accent.text) : 'border border-border-subtle bg-muted text-muted-foreground',
        className
      )}>
      {Icon && <Icon size={8} strokeWidth={2.2} />}
      {label}
    </span>
  )
}

/** Dashed placeholder; with `accent` it is the "add here" target. */
export function SceneSlot({
  accent: isAccent = false,
  className,
  children
}: {
  accent?: boolean
  className?: string
  children?: ReactNode
}) {
  const accent = useAccent()
  return (
    <div
      className={cn(
        'flex shrink-0 items-center rounded-[6px] border border-dashed',
        isAccent ? cn(accent.border, accent.tint, accent.text) : 'border-border-strong',
        className
      )}>
      {children}
    </div>
  )
}

/** Placeholder text line. */
export function SceneBar({ className }: { className?: string }) {
  return <span className={cn('block h-[4px] shrink-0 rounded-full bg-border', className)} />
}

/** Empty row: a dashed outline holding a placeholder line, optionally led by a dashed avatar. */
export function SceneGhostRow({ lead = false, className }: { lead?: boolean; className?: string }) {
  return (
    <SceneSlot className={cn('h-[17px] gap-[6px] px-[7px]', className)}>
      {lead && <span className="size-[7px] shrink-0 rounded-full border border-dashed border-border-strong" />}
      <SceneBar className="w-2/5" />
    </SceneSlot>
  )
}

export function SceneToggle({ on = false, accent: isAccent = false }: { on?: boolean; accent?: boolean }) {
  const accent = useAccent()
  return (
    <span
      className={cn(
        'relative inline-block h-[10px] w-[18px] shrink-0 rounded-full border',
        on ? cn(accent.bg, 'border-transparent') : cn('bg-muted', isAccent ? accent.border : 'border-border-strong')
      )}>
      <span
        className={cn(
          'absolute top-1/2 size-[7px] -translate-y-1/2 rounded-full',
          on ? 'right-[1px] bg-card' : 'left-[1px] bg-muted-foreground'
        )}
      />
    </span>
  )
}

export function SceneCaret({ accent: isAccent = true, className }: { accent?: boolean; className?: string }) {
  const accent = useAccent()
  const reduceMotion = useReducedMotion()
  return (
    <motion.span
      className={cn(
        'inline-block h-[10px] w-[1.4px] shrink-0 rounded-full',
        isAccent ? accent.bg : 'bg-foreground',
        className
      )}
      animate={reduceMotion ? undefined : { opacity: [1, 1, 0, 0] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: 'linear', times: [0, 0.5, 0.5, 1] }}
    />
  )
}

/** Pointer arrow, tip at the element's top-left corner. */
export function SceneCursor({ className }: { className?: string }) {
  return (
    <svg width="13" height="19" viewBox="0 0 10 15" className={cn('absolute fill-foreground stroke-card', className)}>
      <path
        d="M0.5 0.5 V12.5 L3.7 9.6 L6.1 14.9 L8.2 14 L5.9 8.9 L9.8 8.7 Z"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Tab strip; the active tab is underlined with the accent. */
export function SceneTabs({
  items,
  active = 0,
  className
}: {
  items: readonly ReactNode[]
  active?: number
  className?: string
}) {
  const accent = useAccent()
  return (
    <div className={cn('flex shrink-0 items-end gap-[13px] text-[7.5px]', className)}>
      {items.map((item, index) => (
        <span
          key={index}
          className={cn(
            'border-b-[1.5px] pb-[3px] whitespace-nowrap',
            index === active
              ? cn(accent.border, 'font-semibold text-foreground')
              : 'border-transparent text-foreground-tertiary'
          )}>
          {item}
        </span>
      ))}
    </div>
  )
}

/** Slow drift for the one floating element of a scene (a popover or a dragged card). */
export function SceneFloat({ className, children }: { className?: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      className={cn('absolute', className)}
      animate={reduceMotion ? undefined : { y: [0, -3, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
      {children}
    </motion.div>
  )
}
