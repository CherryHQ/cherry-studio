import { TEXT_TO_IMAGES_MODELS } from '@renderer/config/models'
import FileManager from '@renderer/services/FileManager'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addPainting, removePainting, updatePainting, updatePaintings } from '@renderer/store/paintings'
import { Painting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export function usePaintings() {
  const paintings = useAppSelector((state) => state.paintings.paintings)
  const dispatch = useAppDispatch()
  const generateRandomSeed = () => Math.floor(Math.random() * 1000000).toString()

  return {
    paintings,
    addPainting: () => {
      const newPainting: Painting = {
        provider: 'silicon',
        model: TEXT_TO_IMAGES_MODELS.silicon[0].id,
        id: uuid(),
        urls: [],
        files: [],
        prompt: '',
        negativePrompt: '',
        imageSize: '1024x1024',
        numImages: 1,
        seed: generateRandomSeed(),
        steps: 25,
        guidanceScale: 4.5,
        promptEnhancement: true
      }
      dispatch(addPainting(newPainting))
      return newPainting
    },
    removePainting: async (painting: Painting) => {
      FileManager.deleteFiles(painting.files)
      dispatch(removePainting(painting))
    },
    updatePainting: (painting: Painting) => {
      dispatch(updatePainting(painting))
    },
    updatePaintings: (paintings: Painting[]) => {
      dispatch(updatePaintings(paintings))
    }
  }
}
