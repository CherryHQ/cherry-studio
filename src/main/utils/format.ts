export function formatQuotedText(text: string) {
  return (
    text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n') + '\n-------------'
  )
}
