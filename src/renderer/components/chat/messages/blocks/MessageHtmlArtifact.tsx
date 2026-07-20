import { Skeleton } from '@cherrystudio/ui'
import { HtmlArtifactView } from '@renderer/components/chat/HtmlArtifactView'
import { extractHtmlTitle } from '@renderer/utils/formats'
import { memo, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const ARTIFACT_ASPECT_RATIO = 16 / 9
const ARTIFACT_MAX_WIDTH = 1440
const ARTIFACT_HORIZONTAL_GUTTER = 48
const ARTIFACT_MAX_VIEWPORT_HEIGHT_RATIO = 0.72

interface MessageHtmlArtifactProps {
  html: string
  isStreaming: boolean
}

const HtmlArtifactGeneratingPlaceholder = memo(function HtmlArtifactGeneratingPlaceholder({
  label
}: {
  label: string
}) {
  return (
    <div
      data-testid="html-artifact-generating-placeholder"
      role="status"
      className="relative aspect-video w-full overflow-hidden rounded-xl bg-background-subtle p-5">
      <div className="flex items-center gap-2 text-foreground-muted text-xs">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        <span>{label}</span>
      </div>

      <div aria-hidden="true" className="mt-7 space-y-5">
        <div className="space-y-2.5">
          <Skeleton className="h-6 w-2/5 rounded-md" />
          <Skeleton className="h-3 w-3/4 rounded-full opacity-70" />
          <Skeleton className="h-3 w-1/2 rounded-full opacity-50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
        <Skeleton className="h-16 w-full rounded-lg opacity-70" />
      </div>
    </div>
  )
})

export const MessageHtmlArtifact = memo(function MessageHtmlArtifact({ html, isStreaming }: MessageHtmlArtifactProps) {
  const { t } = useTranslation()
  const artifactRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const artifact = artifactRef.current
    if (!artifact) return

    const syncSize = () => {
      const scroller = artifact.closest<HTMLElement>('[data-message-virtual-list-scroller]')
      const messageWrapper = artifact.closest<HTMLElement>('.message')?.parentElement
      const isContainedLayout =
        artifact.closest('.multi-select-mode') !== null ||
        messageWrapper?.classList.contains('grid') ||
        messageWrapper?.classList.contains('horizontal') ||
        messageWrapper?.classList.contains('in-popover')

      if (!scroller || isContainedLayout) {
        artifact.style.removeProperty('width')
        artifact.style.removeProperty('margin-left')
        return
      }

      const scrollerRect = scroller.getBoundingClientRect()
      const contentRect = artifact.parentElement?.getBoundingClientRect()
      const isNarrowLayout = artifact.closest('.narrow-mode.active') !== null
      const horizontalBounds =
        isNarrowLayout && contentRect && contentRect.width > 0
          ? contentRect
          : {
              left: scrollerRect.left + ARTIFACT_HORIZONTAL_GUTTER / 2,
              width: Math.max(0, scrollerRect.width - ARTIFACT_HORIZONTAL_GUTTER)
            }
      const availableHeight = Math.max(0, scrollerRect.height * ARTIFACT_MAX_VIEWPORT_HEIGHT_RATIO)
      const width = Math.floor(
        Math.min(ARTIFACT_MAX_WIDTH, horizontalBounds.width, availableHeight * ARTIFACT_ASPECT_RATIO)
      )
      if (width <= 0) return

      const currentMarginLeft = Number.parseFloat(artifact.style.marginLeft) || 0
      const naturalLeft = artifact.getBoundingClientRect().left - currentMarginLeft
      const targetLeft = horizontalBounds.left + (horizontalBounds.width - width) / 2

      artifact.style.width = `${width}px`
      artifact.style.marginLeft = `${targetLeft - naturalLeft}px`
    }

    syncSize()
    window.addEventListener('resize', syncSize)

    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', syncSize)
    }

    const resizeObserver = new ResizeObserver(syncSize)
    const scroller = artifact.closest<HTMLElement>('[data-message-virtual-list-scroller]')
    if (scroller) resizeObserver.observe(scroller)
    if (artifact.parentElement) resizeObserver.observe(artifact.parentElement)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncSize)
    }
  }, [])

  return (
    <div
      ref={artifactRef}
      data-html-artifact=""
      data-testid="message-html-artifact"
      className="message-html-artifact special-preview mt-0 mb-2.5 w-full">
      {isStreaming ? (
        <HtmlArtifactGeneratingPlaceholder label={t('html_artifacts.generating')} />
      ) : (
        <HtmlArtifactView html={html} title={extractHtmlTitle(html) || t('common.html_preview')} />
      )}
    </div>
  )
})
