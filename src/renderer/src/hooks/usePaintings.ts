import FileManager from '@renderer/services/FileManager'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addPainting, removePainting, updatePainting, updatePaintings } from '@renderer/store/paintings'
import { PaintingAction, PaintingsState } from '@renderer/types'

export function usePaintings() {
  const siliconflow_paintings = useAppSelector((state) => state.paintings.siliconflow_paintings)
  const dmxapi_paintings = useAppSelector((state) => state.paintings.dmxapi_paintings)
  const tokenflux_paintings = useAppSelector((state) => state.paintings.tokenflux_paintings)
  const zhipu_paintings = useAppSelector((state) => state.paintings.zhipu_paintings)
  const aihubmix_image_generate = useAppSelector((state) => state.paintings.aihubmix_image_generate)
  const aihubmix_image_remix = useAppSelector((state) => state.paintings.aihubmix_image_remix)
  const aihubmix_image_edit = useAppSelector((state) => state.paintings.aihubmix_image_edit)
  const aihubmix_image_upscale = useAppSelector((state) => state.paintings.aihubmix_image_upscale)
  const openai_image_generate = useAppSelector((state) => state.paintings.openai_image_generate)
  const openai_image_edit = useAppSelector((state) => state.paintings.openai_image_edit)
  const dispatch = useAppDispatch()

  return {
    siliconflow_paintings,
    dmxapi_paintings,
    tokenflux_paintings,
    zhipu_paintings,
    aihubmix_image_generate,
    aihubmix_image_remix,
    aihubmix_image_edit,
    aihubmix_image_upscale,
    openai_image_generate,
    openai_image_edit,
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
