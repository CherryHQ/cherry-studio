import type { Model } from '@shared/data/types/model'
import {
  isEditImageModel as sharedIsEditImageModel,
  isGenerateImageModel as sharedIsGenerateImageModel,
  isTextToImageModel as sharedIsTextToImageModel,
  isVisionModel as sharedIsVisionModel
} from '@shared/utils/model'

/**
 * Dedicated / text-to-image model = `IMAGE_GENERATION` without `REASONING`.
 * Registry populates both capabilities.
 */
export const isDedicatedImageModel = (model: Model): boolean => sharedIsTextToImageModel(model)

/** Backward-compatible alias. */
export const isDedicatedImageGenerationModel = isDedicatedImageModel

/** Backward-compatible alias — dedicated image models are text→image. */
export const isTextToImageModel = isDedicatedImageModel

/**
 * Image editing model — `IMAGE_GENERATION` + IMAGE input modality.
 */
export const isEditImageModel = (model: Model): boolean => sharedIsEditImageModel(model)

/** @deprecated Use `isEditImageModel`. */
export const isImageEnhancementModel = isEditImageModel

/**
 * @deprecated v1 legacy. v2 moves image generation to tool calls — the
 * chat model stays a general LLM and invokes an image tool, so there's no
 * per-model "this model IS an image generator" toggle to auto-flip. Remove
 * this along with the Inputbar auto-toggle side-effect when v2 lands.
 */
export const isAutoEnableImageGenerationModel = (model: Model): boolean => sharedIsGenerateImageModel(model)

/**
 * Chat-style image generation. Reads shared's `IMAGE_GENERATION` capability.
 */
export const isGenerateImageModel = (model: Model): boolean => !!model && sharedIsGenerateImageModel(model)

/**
 * Pure image generator — can produce images without also acting as a chat /
 * tool-call model. Equivalent to `isTextToImageModel` (IMAGE_GEN && !REASONING).
 */
export const isPureGenerateImageModel = isTextToImageModel

/**
 * Vision-capable model. Reads shared's IMAGE_RECOGNITION / IMAGE input-
 * modality capabilities. v2 `Model.capabilities` is authoritative (registry
 * inference + baked-in user overrides merged by `ModelService`).
 */
export function isVisionModel(model: Model): boolean {
  if (!model) return false
  return sharedIsVisionModel(model)
}
