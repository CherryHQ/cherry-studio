import { defineCreator } from './types'

export default defineCreator({
  id: 'elevenlabs',
  name: 'ElevenLabs',
  idPrefixes: ['eleven', 'scribe'],
  // Audio (TTS / music). Request params (voice/format) belong on the serving provider.
  models: [
    {
      id: 'elevenlabs-v3',
      name: 'ElevenLabs v3',
      capabilities: ['audio-generation'],
      inputModalities: ['text'],
      outputModalities: ['audio']
    },
    {
      id: 'elevenlabs-v2-5-turbo',
      name: 'ElevenLabs v2.5 Turbo',
      capabilities: ['audio-generation'],
      inputModalities: ['text'],
      outputModalities: ['audio']
    },
    {
      id: 'elevenlabs-music',
      name: 'ElevenLabs Music',
      capabilities: ['audio-generation'],
      inputModalities: ['text'],
      outputModalities: ['audio']
    }
  ]
})
