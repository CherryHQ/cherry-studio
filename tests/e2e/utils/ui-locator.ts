import type { Locator, Page } from '@playwright/test'

import { uiSelector, type UiSelectorOptions } from '../../../src/renderer/utils/uiContract'

export type UiLocatorRoot = Locator | Page

/** Locate a public UI-contract node without depending on classes, text, or DOM ancestry. */
export function uiLocator(
  root: UiLocatorRoot,
  semanticId: string,
  options: Omit<UiSelectorOptions, 'semanticId'> = {}
): Locator {
  return root.locator(uiSelector({ ...options, semanticId }))
}
