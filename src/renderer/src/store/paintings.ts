import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { TEXT_TO_IMAGES_MODELS } from '@renderer/config/models'
import { Painting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export interface PaintingsState {
  paintings: Painting[]
}

export const DEFAULT_PAINTING: Painting = {
  id: uuid(),
  urls: [],
  files: [],
  prompt: '',
  negativePrompt: '',
  imageSize: '1024x1024',
  numImages: 1,
  seed: '',
  steps: 25,
  guidanceScale: 4.5,
  model: TEXT_TO_IMAGES_MODELS[0].id
}

const initialState: PaintingsState = {
  paintings: [DEFAULT_PAINTING]
}

const paintingsSlice = createSlice({
  name: 'paintings',
  initialState,
  reducers: {
    updatePaintings: (state, action: PayloadAction<Painting[]>) => {
      state.paintings = action.payload
    },
    addPainting: (state, action: PayloadAction<Painting>) => {
      state.paintings.unshift(action.payload)
    },
    removePainting: (state, action: PayloadAction<Painting>) => {
      if (state.paintings.length === 1) {
        state.paintings = [DEFAULT_PAINTING]
      } else {
        state.paintings = state.paintings.filter((c) => c.id !== action.payload.id)
      }
    },
    updatePainting: (state, action: PayloadAction<Painting>) => {
      state.paintings = state.paintings.map((c) => (c.id === action.payload.id ? action.payload : c))
    }
  }
})

export const { updatePaintings, addPainting, removePainting, updatePainting } = paintingsSlice.actions

export default paintingsSlice.reducer
