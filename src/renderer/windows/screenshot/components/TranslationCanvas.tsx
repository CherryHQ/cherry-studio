import type { Ref } from 'react'
import { useImperativeHandle, useLayoutEffect, useRef } from 'react'

import { Z_INDEX } from '../constants'
import type { SelectionRect, TranslationBlock } from '../types'

export function TranslationCanvas({
  selection,
  scaleFactor,
  blocks,
  visible,
  ref
}: {
  selection: SelectionRect
  scaleFactor: number
  blocks: readonly TranslationBlock[]
  visible: boolean
  ref?: Ref<HTMLCanvasElement | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useImperativeHandle<HTMLCanvasElement | null, HTMLCanvasElement | null>(ref, () => canvasRef.current, [])
  const sx = Math.round(selection.x * scaleFactor)
  const sy = Math.round(selection.y * scaleFactor)
  const sw = Math.round(selection.width * scaleFactor)
  const sh = Math.round(selection.height * scaleFactor)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, sw, sh)
    const family = getComputedStyle(document.body).fontFamily
    for (const block of blocks) {
      if (block.status !== 'succeeded' || !block.box || !block.drawing || !block.translatedText) continue
      const { box, drawing } = block
      const { r, g, b } = drawing.background
      ctx.save()
      ctx.beginPath()
      ctx.rect(box.x, box.y, box.width, box.height)
      ctx.clip()
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(box.x, box.y, box.width, box.height)
      ctx.fillStyle = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#111' : '#fff'
      ctx.font = `${drawing.fontSizePx}px ${family}`
      ctx.fillText(block.translatedText.replace(/\s+/g, ' ').trim(), drawing.baselineX, drawing.baselineY)
      ctx.restore()
    }
  }, [blocks, sw, sh])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    return () => {
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: sx / scaleFactor,
        top: sy / scaleFactor,
        width: sw / scaleFactor,
        height: sh / scaleFactor,
        zIndex: Z_INDEX.TRANSLATION_CANVAS,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        visibility: visible ? 'visible' : 'hidden'
      }}
    />
  )
}
