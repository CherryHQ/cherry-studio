import { application } from '@application'

import { getOutputStyleProse } from '../outputStyles'
import type { SectionContributor } from './types'

/**
 * User-selectable tone preset. Non-cacheable — the user can flip the
 * preference mid-session, so we keep this section past the cache
 * boundary to avoid invalidating identity / assistant_prompt /
 * tool_intros when they do.
 *
 * The default preset emits no prose (identity already covers neutral
 * baseline behavior); the contributor returns `undefined` in that
 * case so the section is dropped from the prompt entirely.
 */
export const outputStyleSection: SectionContributor = () => {
  const style = application.get('PreferenceService').get('feature.system_prompt.output_style')
  const text = getOutputStyleProse(style)
  if (!text) return undefined

  return {
    id: 'output_style',
    text,
    cacheable: false
  }
}
