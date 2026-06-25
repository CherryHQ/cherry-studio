import { defineLab } from './types'

export default defineLab({
  id: 'runway',
  name: 'Runway',
  families: ['runway'],
  idPrefixes: ['runway', 'gen-'],
  // Video generation. Request params (duration/ratio/seed) belong on the serving provider.
  models: [
    {
      id: 'runway-gen-4-turbo',
      name: 'Runway Gen-4 Turbo',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'runway-gen-3a-turbo',
      name: 'Runway Gen-3 Alpha Turbo',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'runway-aleph',
      name: 'Runway Aleph',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    }
  ]
})
