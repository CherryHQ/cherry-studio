import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The same self-contained renderer function is used by CDP and packaged offline smoke runs. */
export function createVoiceRuntimeSmokeExpression(expectedUrl: string, language: 'en-US' | 'zh-CN' = 'en-US'): string {
  const source = readFileSync(join(__dirname, 'renderer.js'), 'utf8')
  return `(() => { const module = { exports: undefined }; ${source}; return module.exports(${JSON.stringify(expectedUrl)}, ${JSON.stringify(language)}); })()`
}
