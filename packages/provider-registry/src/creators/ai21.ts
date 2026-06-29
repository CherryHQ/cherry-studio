import { defineCreator } from './types'

export default defineCreator({
  id: 'ai21',
  name: 'AI21 Labs',
  families: ['jamba'],
  idPrefixes: ['jamba'],
  // Jamba is proprietary with no clean models.dev creator listing and only sparse OpenRouter coverage,
  // so the current line is hand-listed (OpenRouter still enriches the ids it carries).
  models: [{ id: 'jamba-large-1-7' }, { id: 'jamba-mini-1-7' }, { id: 'jamba-1-5-large' }, { id: 'jamba-1-5-mini' }]
})
