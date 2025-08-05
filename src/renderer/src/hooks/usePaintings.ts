import FileManager from '@renderer/services/FileManager'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addPainting, removePainting, updatePainting, updatePaintings } from '@renderer/store/paintings'
import { PaintingAction, PaintingsState } from '@renderer/types'

export function usePaintings() {
  const paintings = useAppSelector((state) => state.paintings.paintings)
  const generate = useAppSelector((state) => state.paintings.generate)
  const remix = useAppSelector((state) => state.paintings.remix)
  const edit = useAppSelector((state) => state.paintings.edit)
  const upscale = useAppSelector((state) => state.paintings.upscale)
  const DMXAPIPaintings = useAppSelector((state) => state.paintings.DMXAPIPaintings)
  const tokenFluxPaintings = useAppSelector((state) => state.paintings.tokenFluxPaintings)
  const openai_image_generate = useAppSelector((state) => state.paintings.openai_image_generate)
  const openai_image_edit = useAppSelector((state) => state.paintings.openai_image_edit)
  const dispatch = useAppDispatch()

  return {
    paintings,
    DMXAPIPaintings,
    tokenFluxPaintings,
    persistentData: {
      generate,
      remix,
      edit,
      upscale,
      tokenFluxPaintings
    },
    newApiPaintings: {
      openai_image_generate,
      openai_image_edit
    },
    addPainting: (namespace: keyof PaintingsState, painting: PaintingAction) => {
      dispatch(addPainting({ namespace, painting }))
      return painting
    },
    removePainting: async (namespace: keyof PaintingsState, painting: PaintingAction) => {
      FileManager.deleteFiles(painting.files)
      dispatch(removePainting({ namespace, painting }))
    },
    updatePainting: (namespace: keyof PaintingsState, painting: PaintingAction) => {
      dispatch(updatePainting({ namespace, painting }))
    },
    updatePaintings: (namespace: keyof PaintingsState, paintings: PaintingAction[]) => {
      dispatch(updatePaintings({ namespace, paintings }))
    }
  }
}
