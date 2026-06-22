/**
 * Lightweight celebration confetti.
 *
 * Implemented with a local CSS animation (no extra dependency). The burst is
 * anchored to its parent center so it can shoot out of the completion emoji
 * instead of falling from the full viewport.
 */

import React, { useMemo } from 'react'

const COLORS = [
  'var(--color-primary)',
  'var(--color-green-500)',
  'var(--color-blue-500)',
  'var(--color-amber-500)',
  'var(--color-pink-500)',
  'var(--color-sky-500)'
]

const PIECE_COUNT = 60

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

export const Confetti: React.FC = () => {
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECE_COUNT }).map((_, i) => {
        const angle = Math.random() * Math.PI
        const velocity = 56 + Math.random() * 148
        const x = Math.cos(angle) * velocity
        const rise = -(36 + Math.random() * 124)
        const fall = 216 + Math.random() * 284
        const rotate = (Math.random() - 0.5) * 720

        return {
          id: i,
          x,
          midX: x * 0.45,
          rise,
          fall,
          delay: Math.random() * 0.12,
          duration: 1.5 + Math.random() * 1.1,
          size: 5 + Math.random() * 6,
          rotate,
          rotateEnd: rotate * 1.35,
          color: COLORS[i % COLORS.length],
          round: Math.random() < 0.35
        }
      }),
    []
  )

  if (prefersReducedMotion()) {
    return null
  }

  return (
    <span
      className="migration-confetti pointer-events-none absolute top-1/2 left-1/2 z-20 overflow-visible"
      aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="migration-confetti__piece"
          style={{
            width: p.size,
            height: p.round ? p.size : p.size * 0.5,
            background: p.color,
            borderRadius: p.round ? '9999px' : '1px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--confetti-x' as string]: `${p.x}px`,
            ['--confetti-mid-x' as string]: `${p.midX}px`,
            ['--confetti-rise' as string]: `${p.rise}px`,
            ['--confetti-fall' as string]: `${p.fall}px`,
            ['--confetti-rotate' as string]: `${p.rotate}deg`,
            ['--confetti-rotate-end' as string]: `${p.rotateEnd}deg`
          }}
        />
      ))}
      <style>{`
        .migration-confetti__piece {
          position: absolute;
          left: 0;
          top: 0;
          opacity: 0;
          animation-name: migration-confetti-burst;
          animation-timing-function: cubic-bezier(0.2, 0.6, 0.4, 1);
          animation-iteration-count: 1;
          animation-fill-mode: forwards;
        }
        @keyframes migration-confetti-burst {
          0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; }
          24% { transform: translate3d(var(--confetti-mid-x, 0), var(--confetti-rise, -80px), 0) rotate(var(--confetti-rotate, 180deg)); opacity: 1; }
          100% { transform: translate3d(var(--confetti-x, 0), var(--confetti-fall, 260px), 0) rotate(var(--confetti-rotate-end, 360deg)); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .migration-confetti { display: none; }
        }
      `}</style>
    </span>
  )
}
