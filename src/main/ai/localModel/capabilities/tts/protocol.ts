import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'

export interface TtsSynthesizeInput {
  text: string
  voice: string
  language: string
  speed: number
  outputPath: string
}

export type TtsInferenceContract = {
  methods: {
    synthesize: UtilityProcessMethod<TtsSynthesizeInput & { modelDir: string }, void>
  }
}

export interface TtsInitData {
  appPath: string
  bindingPath: string
}
