import { defineLab } from './types'

export default defineLab({
  id: 'suno',
  name: 'Suno',
  idPrefixes: ['suno', 'chirp'],
  // Music generation. Request params (lyrics/style/duration) belong on the serving provider.
  models: [
    {
      id: 'suno-v4-5',
      name: 'Suno v4.5',
      capabilities: ['audio-generation'],
      inputModalities: ['text'],
      outputModalities: ['audio']
    },
    {
      id: 'suno-v4',
      name: 'Suno v4',
      capabilities: ['audio-generation'],
      inputModalities: ['text'],
      outputModalities: ['audio']
    },
    {
      id: 'suno-v3-5',
      name: 'Suno v3.5',
      capabilities: ['audio-generation'],
      inputModalities: ['text'],
      outputModalities: ['audio']
    },
    {
      id: 'suno-v3',
      name: 'Suno v3',
      capabilities: ['audio-generation'],
      inputModalities: ['text'],
      outputModalities: ['audio']
    }
  ]
})
