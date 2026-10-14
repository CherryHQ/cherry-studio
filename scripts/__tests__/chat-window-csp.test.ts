import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT_DIR = resolve(__dirname, '..', '..')
const CHAT_WINDOW_HTML_PATHS = [
  'src/renderer/windows/main/index.html',
  'src/renderer/windows/subWindow/index.html',
  'src/renderer/windows/quickAssistant/index.html'
]

describe('chat window content security policies', () => {
  it.each(CHAT_WINDOW_HTML_PATHS)('%s permits remote media playback', (relativePath) => {
    const html = readFileSync(resolve(ROOT_DIR, relativePath), 'utf8')
    const content = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
    const mediaSources = content
      ?.split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .find(([directive]) => directive === 'media-src')

    expect(mediaSources).toEqual(expect.arrayContaining(['media-src', "'self'", 'file:', 'http:', 'https:']))
  })
})
