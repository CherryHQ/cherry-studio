import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { X } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  value: string | null
  onChange: (tag: string | null) => void
  allTagNames: string[]
  disabled?: boolean
  portalContainer?: HTMLElement | null
}

const TAG_SELECT_VALUE_PREFIX = 'tag:'
const TAG_SELECT_CONTENT_ATTR = 'data-tag-selector-content'
const TAG_SELECT_CONTENT_SELECTOR = `[${TAG_SELECT_CONTENT_ATTR}]`

function encodeTagSelectValue(name: string) {
  return `${TAG_SELECT_VALUE_PREFIX}${name}`
}

function decodeTagSelectValue(value: string) {
  if (!value.startsWith(TAG_SELECT_VALUE_PREFIX)) return null
  return value.slice(TAG_SELECT_VALUE_PREFIX.length)
}

function isTargetInsideElement(event: Event, element: HTMLElement) {
  return event.target instanceof Node && element.contains(event.target)
}

function isPointerInsideElementBounds(event: PointerEvent | MouseEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false

  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

function isTagSelectSurface(target: EventTarget | null, root: HTMLElement | null) {
  if (!(target instanceof Element)) return false
  return Boolean(root?.contains(target) || target.closest(TAG_SELECT_CONTENT_SELECTOR))
}

export const TagSelector: FC<Props> = ({ value, onChange, allTagNames, disabled, portalContainer }) => {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const suppressNextClickRef = useRef(false)
  const clickShieldResetTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)

  // `value` may be a name not present in `/tags` yet, for example while a
  // caller waits for SWR refresh. Keep the selected name visible in the options.
  const tagNames = useMemo(() => {
    const names = new Set(allTagNames)
    if (value) names.add(value)

    const sortedNames = Array.from(names)
    sortedNames.sort((a, b) => a.localeCompare(b, 'zh'))
    return sortedNames
  }, [allTagNames, value])

  useEffect(() => {
    if (!portalContainer) return

    const ownerDocument = portalContainer.ownerDocument
    const ownerWindow = ownerDocument.defaultView ?? window

    const clearClickShieldResetTimer = () => {
      if (clickShieldResetTimerRef.current === null) return

      ownerWindow.clearTimeout(clickShieldResetTimerRef.current)
      clickShieldResetTimerRef.current = null
    }

    const releaseClickShield = () => {
      clearClickShieldResetTimer()
      suppressNextClickRef.current = false
    }

    const scheduleClickShieldReset = () => {
      if (!suppressNextClickRef.current) return

      clearClickShieldResetTimer()
      clickShieldResetTimerRef.current = ownerWindow.setTimeout(releaseClickShield, 0)
    }

    const suppressClickAfterManualClose = (event: MouseEvent) => {
      if (!suppressNextClickRef.current) return

      releaseClickShield()
      if (!isTargetInsideElement(event, portalContainer) && !isPointerInsideElementBounds(event, portalContainer))
        return

      event.preventDefault()
      event.stopPropagation()
    }

    ownerDocument.addEventListener('click', suppressClickAfterManualClose, true)
    ownerDocument.addEventListener('pointerup', scheduleClickShieldReset, true)
    ownerDocument.addEventListener('pointercancel', releaseClickShield, true)

    return () => {
      ownerDocument.removeEventListener('click', suppressClickAfterManualClose, true)
      ownerDocument.removeEventListener('pointerup', scheduleClickShieldReset, true)
      ownerDocument.removeEventListener('pointercancel', releaseClickShield, true)
      releaseClickShield()
    }
  }, [portalContainer])

  useEffect(() => {
    if (!open || !portalContainer) return

    const ownerDocument = portalContainer.ownerDocument

    const closeForInsideDialogPointerDown = (event: PointerEvent) => {
      if (isTagSelectSurface(event.target, rootRef.current)) return

      const targetInsidePortal = isTargetInsideElement(event, portalContainer)
      if (!targetInsidePortal && !isPointerInsideElementBounds(event, portalContainer)) return

      suppressNextClickRef.current = !targetInsidePortal
      setOpen(false)

      if (!targetInsidePortal) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    ownerDocument.addEventListener('pointerdown', closeForInsideDialogPointerDown, true)

    return () => {
      ownerDocument.removeEventListener('pointerdown', closeForInsideDialogPointerDown, true)
    }
  }, [open, portalContainer])

  return (
    <div ref={rootRef} className="group/tag-select relative flex w-full min-w-0 items-center">
      <Select
        disabled={disabled}
        open={open}
        value={value ? encodeTagSelectValue(value) : ''}
        onOpenChange={setOpen}
        onValueChange={(selectedValue) => onChange(decodeTagSelectValue(selectedValue))}>
        <SelectTrigger
          size="sm"
          className={cn(
            'w-full',
            value &&
              '[&_svg]:transition-opacity group-focus-within/tag-select:[&_svg]:opacity-0 group-hover/tag-select:[&_svg]:opacity-0'
          )}
          aria-label={t('library.config.basic.tags')}>
          <SelectValue placeholder={t('library.config.basic.tag_placeholder')} />
        </SelectTrigger>
        <SelectContent portalContainer={portalContainer ?? undefined} {...{ [TAG_SELECT_CONTENT_ATTR]: '' }}>
          {tagNames.map((name) => (
            <SelectItem key={name} value={encodeTagSelectValue(name)}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`${t('library.config.basic.tags')} ${t('common.clear')}`}
          onClick={(event) => {
            event.stopPropagation()
            onChange(null)
          }}
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 flex size-5 min-h-0 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground/70 opacity-0 shadow-none transition-[background-color,color,opacity] hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 active:bg-muted group-focus-within/tag-select:pointer-events-auto group-focus-within/tag-select:opacity-100 group-hover/tag-select:pointer-events-auto group-hover/tag-select:opacity-100">
          <X size={12} />
        </Button>
      ) : null}
    </div>
  )
}
