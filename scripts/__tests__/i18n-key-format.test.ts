import { expect, it } from 'vitest'

import { checkTranslationKeyFormat } from '../i18n-key-format'

it.each(['agent_import_missing_file', 'title', '', '.title', 'agent.', 'agent..title', 'agent. title'])(
  'rejects the non-namespaced or malformed catalog key %j',
  (key) => {
    expect(() => checkTranslationKeyFormat([key])).toThrow('dot-separated')
  }
)

it('allows dotted keys with underscores, camel case, and locale plural suffixes', () => {
  expect(() =>
    checkTranslationKeyFormat(['agent.import.missing_file', 'apiGateway.docs.title', 'message.citation_other'])
  ).not.toThrow()
})
