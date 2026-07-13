import { describe, expect, it } from 'vitest'

import type { PreferenceSchemas } from '../preferenceSchemas'
import { DefaultPreferences } from '../preferenceSchemas'

describe('DefaultPreferences', () => {
  it('uses flat file processing default keys', () => {
    const markdownConversionDefault: PreferenceSchemas['default']['feature.file_processing.default_document_to_markdown'] =
      null

    expect(markdownConversionDefault).toBeNull()
    expect(DefaultPreferences.default['feature.file_processing.default_document_to_markdown']).toBeNull()
    expect(DefaultPreferences.default['feature.file_processing.default_image_to_text']).toBeNull()
    expect('feature.file_processing.default.document_to_markdown' in DefaultPreferences.default).toBe(false)
    expect('feature.file_processing.default.image_to_text' in DefaultPreferences.default).toBe(false)
  })

  it('defaults the URL fetch web search provider to jina', () => {
    const fetchUrlsDefault: PreferenceSchemas['default']['chat.web_search.default_fetch_urls_provider'] = 'jina'

    expect(DefaultPreferences.default['chat.web_search.default_fetch_urls_provider']).toBe(fetchUrlsDefault)
  })

  it('defaults the keyword search web search provider to exa-mcp', () => {
    const searchKeywordsDefault: PreferenceSchemas['default']['chat.web_search.default_search_keywords_provider'] =
      'exa-mcp'

    expect(DefaultPreferences.default['chat.web_search.default_search_keywords_provider']).toBe(searchKeywordsDefault)
  })

  it('uses the default grouping and sort profiles for conversations and agent sessions', () => {
    const topicDisplayDefault: PreferenceSchemas['default']['topic.tab.display_mode'] = 'assistant'
    const agentSessionDisplayDefault: PreferenceSchemas['default']['agent.session.display_mode'] = 'agent'
    const topicSortDefault: PreferenceSchemas['default']['topic.sort_type'] = 'createdAt'
    const agentSessionSortDefault: PreferenceSchemas['default']['agent.session.sort_type'] = 'orderKey'

    expect(DefaultPreferences.default['topic.tab.display_mode']).toBe(topicDisplayDefault)
    expect(DefaultPreferences.default['agent.session.display_mode']).toBe(agentSessionDisplayDefault)
    expect(DefaultPreferences.default['topic.sort_type']).toBe(topicSortDefault)
    expect(DefaultPreferences.default['agent.session.sort_type']).toBe(agentSessionSortDefault)
  })

  it('defaults sidebar favorites to the canonical five app tabs for new users', () => {
    const sidebarFavoritesDefault: PreferenceSchemas['default']['ui.sidebar.favorites'] = [
      { id: 'assistants', type: 'app' },
      { id: 'agents', type: 'app' },
      { id: 'translate', type: 'app' },
      { id: 'paintings', type: 'app' },
      { id: 'knowledge', type: 'app' }
    ]

    expect(DefaultPreferences.default['ui.sidebar.favorites']).toEqual(sidebarFavoritesDefault)
  })

  it('does not keep legacy classic/modern layout preferences', () => {
    expect('topic.layout' in DefaultPreferences.default).toBe(false)
    expect('agent.layout' in DefaultPreferences.default).toBe(false)
  })
})
