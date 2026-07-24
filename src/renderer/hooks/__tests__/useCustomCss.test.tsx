import { removeV1CustomCssMarker, V1_CUSTOM_CSS_MARKER } from '@shared/utils/customCssMigration'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useCustomCssInjection } from '../useCustomCss'

const CUSTOM_CSS_ELEMENT_ID = 'user-defined-custom-css'

describe('useCustomCssInjection', () => {
  afterEach(() => {
    document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove()
  })

  it('does not inject v1-marked CSS and resumes injection after the marker is removed', () => {
    const cssPayload = 'body { color: tomato; }'
    const markedCss = `${V1_CUSTOM_CSS_MARKER}\n${cssPayload}`
    const { rerender } = renderHook(({ cssText }) => useCustomCssInjection(cssText), {
      initialProps: { cssText: markedCss }
    })

    expect(document.getElementById(CUSTOM_CSS_ELEMENT_ID)).toBeNull()

    rerender({ cssText: removeV1CustomCssMarker(markedCss) })

    expect(document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.textContent).toBe(cssPayload)
  })
})
