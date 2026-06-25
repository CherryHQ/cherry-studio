import { defineLab } from './types'

export default defineLab({
  id: 'bria',
  name: 'Bria',
  families: ['bria'],
  idPrefixes: ['bria'],
  // Image generation/editing. Served as `bria/<op>` → canonicalizes to the bare op id; request params
  // belong on the serving provider.
  models: [
    {
      id: 'image-3-2',
      name: 'Bria Image 3.2',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'fibo',
      name: 'Bria FIBO',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'fibo-edit',
      name: 'Bria FIBO Edit',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    },
    {
      id: 'eraser',
      name: 'Bria Eraser',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    },
    {
      id: 'genfill',
      name: 'Bria GenFill',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    },
    {
      id: 'expand-image',
      name: 'Bria Expand Image',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    },
    {
      id: 'generate-background',
      name: 'Bria Generate Background',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    }
  ]
})
