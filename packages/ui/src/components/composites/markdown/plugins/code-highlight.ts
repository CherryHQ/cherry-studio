import type { BundledLanguage, CodeHighlighterPlugin } from 'streamdown'

import { createCodeBlockSnapshotExecutor } from '../../../../code-block'
import { CODE_LANGUAGES, plainTokens, supportsCodeLanguage, type SnapshotExecutor } from '../../../../code-highlight'

const executeLocal = createCodeBlockSnapshotExecutor()
const STREAMDOWN_LANGUAGES = Object.keys(CODE_LANGUAGES).filter(
  (name): name is BundledLanguage => !['text', 'c3', 'cuda', 'tsrx'].includes(name)
)

export function createCodeHighlightPlugin({
  execute = executeLocal,
  themes = ['github-light', 'github-dark']
}: { execute?: SnapshotExecutor; themes?: [string, string] } = {}): CodeHighlighterPlugin {
  return {
    // Streamdown 2.5 fixes this discriminator even for custom highlighting engines.
    name: 'shiki',
    type: 'code-highlighter',
    getSupportedLanguages: () => [...STREAMDOWN_LANGUAGES],
    getThemes: () => [
      { name: themes[0], settings: [] },
      { name: themes[1], settings: [] }
    ],
    supportsLanguage: supportsCodeLanguage,
    highlight({ code, language, themes: selected }, callback) {
      const names = selected.map((theme, index) => (typeof theme === 'string' ? theme : theme.name) ?? themes[index])
      void execute({ code, language, themes: [names[0], names[1]] }).then(callback, () => callback?.(plainTokens(code)))
      return null
    }
  }
}
