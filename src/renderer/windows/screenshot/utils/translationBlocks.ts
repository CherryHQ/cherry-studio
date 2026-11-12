import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { OcrTextLine } from '@shared/ipc/schemas/screenshot'

import type { PhysicalBox, TranslationBlock } from '../types'

const family = (code: TranslateLangCode) => code.split('-')[0]
const intersects = (a: PhysicalBox, b: PhysicalBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

function normalizeBox(box: PhysicalBox, crop: { width: number; height: number }): PhysicalBox | null {
  if (
    ![box.x, box.y, box.width, box.height, crop.width, crop.height].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0 ||
    crop.width <= 0 ||
    crop.height <= 0
  )
    return null
  const x = Math.max(0, Math.floor(box.x))
  const y = Math.max(0, Math.floor(box.y))
  const right = Math.min(crop.width, Math.ceil(box.x + box.width))
  const bottom = Math.min(crop.height, Math.ceil(box.y + box.height))
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

function compatible(text: string): boolean {
  const scripts = [
    /\p{Script=Latin}/u,
    /\p{Script=Cyrillic}/u,
    /\p{Script=Han}/u,
    /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
    /\p{Script=Hangul}/u,
    /\p{Script=Arabic}/u,
    /\p{Script=Devanagari}/u,
    /\p{Script=Thai}/u,
    /\p{Script=Greek}/u,
    /\p{Script=Hebrew}/u
  ]
  const letters = [...text].filter((char) => /\p{L}/u.test(char))
  if (letters.some((char) => !scripts.some((script) => script.test(char)))) return false
  const found = scripts.map((script) => letters.some((char) => script.test(char)))
  const count = found.filter(Boolean).length
  return count <= 1 || (count === 2 && found[2] && (found[3] || found[4]))
}

export function classifyTranslationBlocks(
  lines: readonly OcrTextLine[],
  detectedLanguages: readonly TranslateLangCode[],
  targetLangCode: TranslateLangCode,
  cropSize: { width: number; height: number }
): { sourceLangCode: TranslateLangCode | null; blocks: TranslationBlock[] } {
  const boxes = lines.map((line) => normalizeBox(line.box, cropSize))
  const weights = new Map<string, { weight: number; code: TranslateLangCode }>()
  const blocks: TranslationBlock[] = lines.map((line, id) => {
    const box = boxes[id]
    const detectedLanguage = detectedLanguages[id] ?? 'unknown'
    const letters = [...line.text.trim()].filter((char) => /\p{L}/u.test(char)).length
    let reason: string | undefined
    if (letters < 10) reason = 'unknown_language'
    else if (!compatible(line.text)) reason = 'mixed_script'
    else if (detectedLanguage === 'unknown') reason = 'unknown_language'
    else if (family(detectedLanguage) === family(targetLangCode)) reason = 'target_language'
    if (!reason) {
      const key = family(detectedLanguage)
      const current = weights.get(key)
      weights.set(key, { weight: (current?.weight ?? 0) + letters, code: current?.code ?? detectedLanguage })
    }
    if (!box) reason = 'invalid_geometry'
    else if (boxes.some((other, index) => index !== id && other && intersects(box, other))) reason = 'overlap'
    return { id, sourceText: line.text, originalBox: { ...line.box }, box, detectedLanguage, status: 'skipped', reason }
  })
  const total = [...weights.values()].reduce((sum, entry) => sum + entry.weight, 0)
  const source = [...weights.values()].find((entry) => entry.weight > total / 2)?.code ?? null
  for (const block of blocks) {
    if (block.reason) continue
    if (source && family(block.detectedLanguage) === family(source)) block.status = 'queued'
    else block.reason = 'other_language'
  }
  return { sourceLangCode: source, blocks }
}
