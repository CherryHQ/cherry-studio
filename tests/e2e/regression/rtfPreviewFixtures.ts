import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function createRtfPreviewFixtures(directory: string): Promise<Record<string, string>> {
  await mkdir(directory, { recursive: true })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=',
    'base64'
  )
  const unicode = (text: string) => Array.from(text, (char) => `\\u${char.charCodeAt(0)}?`).join('')
  const link = (url: string, label: string) => `{\\field{\\*\\fldinst HYPERLINK "${url}"}{\\fldrslt ${label}}}\\par `
  const simple =
    String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0 Arial;}}\uc1\f0\fs24 ` +
    unicode('中文富文本预览') +
    String.raw`\par {\b Bold MP150}\par {\i Italic MP150}\par ` +
    `{\\pict\\pngblip\\picw1\\pich1\\picwgoal480\\pichgoal480 ${png.toString('hex')}}\\par ` +
    link('https://example.com/mp150', 'HTTPS MP150') +
    link('http://example.com/mp150', 'HTTP MP150') +
    link('mailto:mp150@example.com', 'Email MP150') +
    link('javascript:alert(150)', 'Unsafe JS MP150') +
    link('file:///mp150-should-never-open', 'Unsafe File MP150') +
    '}'
  const big = `{\\rtf1\\ansi ${'MP150 large document \\par '.repeat(500_000)}}`
  const contents = {
    'simple.rtf': Buffer.from(simple, 'ascii'),
    // Actual GBK bytes for 中文旧文档; no Unicode escapes can mask a wrong decoder.
    'gbk.rtf': Buffer.concat([
      Buffer.from('{\\rtf1\\ansi\\ansicpg936 '),
      Buffer.from('d6d0cec4bec9cec4b5b5', 'hex'),
      Buffer.from('}')
    ]),
    'big.rtf': Buffer.from(big, 'ascii'),
    'truncated.rtf': Buffer.from('{\\rtf1\\ansi {\\pict\\pngblip 89504e47', 'ascii'),
    'contrast.png': png
  }
  const paths: Record<string, string> = {}
  for (const [name, content] of Object.entries(contents)) {
    paths[name] = join(directory, name)
    await writeFile(paths[name], content)
  }
  if (contents['big.rtf'].length <= 10 * 1024 * 1024) throw new Error('big.rtf must exceed 10 MiB')
  return paths
}
