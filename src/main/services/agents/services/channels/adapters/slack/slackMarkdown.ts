/**
 * Convert standard Markdown to Slack mrkdwn format.
 *
 * Key differences:
 * - Bold:          **text**  ->  *text*
 * - Italic:        *text*   ->  _text_
 * - Strikethrough: ~~text~~ ->  ~text~
 * - Links:         [text](url) -> <url|text>
 * - Headers:       # text   ->  *text*  (bold as substitute)
 *
 * Code blocks and inline code are preserved as-is since Slack
 * uses the same backtick syntax.
 */

type Segment = { type: 'code'; text: string } | { type: 'text'; text: string }

/**
 * Split text into code (fenced blocks + inline) and non-code segments
 * so we only transform non-code portions.
 */
function splitCodeSegments(input: string): Segment[] {
  const segments: Segment[] = []
  // Match fenced code blocks (```...```) and inline code (`...`)
  const codePattern = /(```[\s\S]*?```|`[^`\n]+`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codePattern.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: input.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'code', text: match[0] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < input.length) {
    segments.push({ type: 'text', text: input.slice(lastIndex) })
  }

  return segments
}

function convertTextSegment(text: string): string {
  // Links: [text](url) -> <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')

  // Bold: **text** -> *text*  (must be done before italic)
  // Use a placeholder to avoid conflict with italic conversion
  text = text.replace(/\*\*(.+?)\*\*/g, '\x01$1\x01')

  // Italic: *text* -> _text_  (single asterisks that aren't part of bold)
  text = text.replace(/(?<!\x01)\*(.+?)\*(?!\x01)/g, '_$1_')

  // Restore bold placeholders
  text = text.replace(/\x01(.+?)\x01/g, '*$1*')

  // Strikethrough: ~~text~~ -> ~text~
  text = text.replace(/~~(.+?)~~/g, '~$1~')

  // Headers: lines starting with # -> bold text
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')

  return text
}

/**
 * Convert standard Markdown text to Slack mrkdwn.
 * Preserves code blocks and inline code untouched.
 */
export function toSlackMarkdown(markdown: string): string {
  if (!markdown) return markdown

  const segments = splitCodeSegments(markdown)
  return segments.map((s) => (s.type === 'code' ? s.text : convertTextSegment(s.text))).join('')
}
