import * as z from 'zod'

const REFERENCES_SCHEMA = z.array(z.string().trim().min(1))

export interface IllustrationIntent {
  prompt: string
  references: string[]
}

/** A reserved first line carries references; legacy blocks remain plain prompts. */
export function parseIllustrationIntent(value: string): IllustrationIntent | null {
  const text = value.trim()
  if (!/^references:/i.test(text)) return { prompt: text, references: [] }
  const newline = text.indexOf('\n')
  const header = text.slice(0, newline)
  const match = /^references:\s*(.*)$/i.exec(header)
  if (!match || newline < 0) return null
  try {
    const references = REFERENCES_SCHEMA.parse(JSON.parse(match[1]))
    const prompt = text.slice(newline + 1).trim()
    return prompt ? { prompt, references: [...new Set(references)] } : null
  } catch {
    return null
  }
}
