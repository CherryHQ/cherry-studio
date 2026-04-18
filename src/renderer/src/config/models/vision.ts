import type { Model } from '@renderer/types'
import { isUserSelectedModelType } from '@renderer/utils'
import {
  isEditImageModel as sharedIsEditImageModel,
  isGenerateImageModel as sharedIsGenerateImageModel,
  isTextToImageModel as sharedIsTextToImageModel,
  isVisionModel as sharedIsVisionModel
} from '@shared/utils/model'

import { toSharedCompatModel } from './_bridge'

/**
 * Dedicated / text-to-image model = `IMAGE_GENERATION` without `REASONING`.
 * Registry / bridge populate both capabilities.
 */
export const isDedicatedImageModel = (model: Model): boolean => sharedIsTextToImageModel(toSharedCompatModel(model))

/** Backward-compatible alias. */
export const isDedicatedImageGenerationModel = isDedicatedImageModel

/** Backward-compatible alias — dedicated image models are text→image. */
export const isTextToImageModel = isDedicatedImageModel

/**
 * Image editing model — `IMAGE_GENERATION` + IMAGE input modality. The
 * bridge populates `inputModalities: [IMAGE]` whenever a v1 id matches
 * vision / image-edit inference, so shared's check is authoritative.
 */
export const isEditImageModel = (model: Model): boolean => sharedIsEditImageModel(toSharedCompatModel(model))

/** @deprecated Use `isEditImageModel`. */
export const isImageEnhancementModel = isEditImageModel

/**
 * @deprecated v1 legacy. v2 moves image generation to tool calls — the
 * chat model stays a general LLM and invokes an image tool, so there's no
 * per-model "this model IS an image generator" toggle to auto-flip. Remove
 * this along with the Inputbar auto-toggle side-effect when v2 lands.
 */
export const isAutoEnableImageGenerationModel = (model: Model): boolean =>
  sharedIsGenerateImageModel(toSharedCompatModel(model))

/**
 * Chat-style image generation. Reads shared's `IMAGE_GENERATION` capability.
 */
export const isGenerateImageModel = (model: Model): boolean =>
  !!model && sharedIsGenerateImageModel(toSharedCompatModel(model))

/**
 * Pure image generator — can produce images without also acting as a chat /
 * tool-call model. Equivalent to `isTextToImageModel` (IMAGE_GEN && !REASONING).
 */
export const isPureGenerateImageModel = isTextToImageModel

/**
 * Vision-capable model. Reads shared's IMAGE_RECOGNITION / IMAGE input-
 * modality capabilities. User preference override sits on top.
 */
export function isVisionModel(model: Model): boolean {
  if (!model) return false
  const override = isUserSelectedModelType(model, 'vision')
  if (override !== undefined) return override
  return sharedIsVisionModel(toSharedCompatModel(model))
}
