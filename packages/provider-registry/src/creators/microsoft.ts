import { defineCreator } from './types'

export default defineCreator({
  id: 'microsoft',
  name: 'Microsoft',
  families: ['phi'],
  idPrefixes: ['phi', 'mai'],
  models: [{ id: 'mai-image-2-5', name: 'MicrosoftAI: MAI-Image-2.5' }]
})
