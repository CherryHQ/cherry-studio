import { IDENTITY_PROMPT } from '../identity'
import type { SectionContributor } from './types'

/**
 * Cherry's built-in identity prose. Always emitted, frozen — the user
 * cannot disable it. First section in the cacheable group; provides
 * the foundation every assistant prompt sits on top of.
 */
export const identitySection: SectionContributor = () => ({
  id: 'identity',
  text: IDENTITY_PROMPT,
  cacheable: true
})
