import { chars, icons } from '@iconify-json/fluent-emoji-flat'
import emojiData from 'emoji-picker-element-data/en/cldr/data.json'
import fs from 'fs/promises'
import path from 'path'

interface EmojiRecord {
  emoji: string
  group: number
}

interface IconData {
  body: string
  width?: number
  height?: number
}

const OUTPUT_FILE = path.join(__dirname, '../src/fluent-emoji-data.json')
const VARIATION_SELECTOR_16 = 'fe0f'

function toCodepointKeys(emoji: string): string[] {
  const codepoints = Array.from(emoji).map((char) => char.codePointAt(0)?.toString(16) ?? '')
  const exact = codepoints.join('-')
  const withoutEmojiPresentation = codepoints.filter((codepoint) => codepoint !== VARIATION_SELECTOR_16).join('-')

  return exact === withoutEmojiPresentation ? [exact] : [exact, withoutEmojiPresentation]
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
}

async function main() {
  const codepointToIconName: Record<string, string> = {}
  const iconData: Record<string, Required<IconData>> = {}
  const records = emojiData as EmojiRecord[]

  for (const record of records) {
    if (record.group >= 9) continue

    for (const key of toCodepointKeys(record.emoji)) {
      const iconName = chars[key]
      const icon = iconName ? (icons.icons[iconName] as IconData | undefined) : undefined
      if (!icon) continue

      codepointToIconName[key] = iconName
      iconData[iconName] = {
        body: icon.body,
        width: icon.width ?? icons.width ?? 32,
        height: icon.height ?? icons.height ?? 32
      }
      break
    }
  }

  const dataset = {
    codepointToIconName: sortRecord(codepointToIconName),
    icons: sortRecord(iconData)
  }
  const output = `${JSON.stringify(dataset).replace(/</g, '\\u003c')}\n`

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true })
  await fs.writeFile(OUTPUT_FILE, output, 'utf-8')
  console.log(
    `Generated ${Object.keys(iconData).length} Fluent emoji icons from ${Object.keys(codepointToIconName).length} codepoint mappings.`
  )
}

void main()
