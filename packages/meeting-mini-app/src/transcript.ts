export interface TranscriptParagraph {
  text: string
  timestamp?: string
}

export function transcriptParagraphs(text: string): TranscriptParagraph[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .filter((block) => block.trim())
    .map((block) => {
      const cue = block.match(
        /^(?:\d+\n)?(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}[^\n]*\n([\s\S]+)$/
      )
      return cue ? { timestamp: cue[1].replace(',', '.'), text: cue[2].trim() } : { text: block.trim() }
    })
}
