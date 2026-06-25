import { defineLab } from './types'

export default defineLab({
  id: 'luma',
  name: 'Luma AI',
  idPrefixes: ['ray', 'photon'],
  // Photon = image generation (Ray = video). Request params belong on the serving provider.
  models: [
    {
      id: 'photon',
      name: 'Luma Photon',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'photon-flash',
      name: 'Luma Photon Flash',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    }
  ]
})
