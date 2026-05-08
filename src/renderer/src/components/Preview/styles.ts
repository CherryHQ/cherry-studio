import { Flex } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import React from 'react'

type DivProps = React.ComponentProps<'div'>
type ShadowContainerStyle = React.CSSProperties & Record<string, string>

export const PreviewError = ({ className, ref, ...props }: DivProps) =>
  React.createElement('div', {
    ref,
    className: cn(
      'overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-[#ff4d4f] p-4 text-[#ff4d4f]',
      className
    ),
    ...props
  })

PreviewError.displayName = 'PreviewError'

export const PreviewContainer = ({
  className,
  role = 'alert',
  ...props
}: React.ComponentPropsWithoutRef<typeof Flex>) =>
  React.createElement(Flex, {
    role,
    className: cn(
      'relative min-h-[8rem] [&_.special-preview]:min-h-[8rem]',
      '[&_.preview-toolbar]:transform-gpu [&_.preview-toolbar]:opacity-0 [&_.preview-toolbar]:transition-opacity [&_.preview-toolbar]:duration-300 [&_.preview-toolbar]:ease-in-out [&_.preview-toolbar]:will-change-[opacity]',
      '[&:hover_.preview-toolbar]:opacity-100',
      className
    ),
    ...props
  })

const shadowWhiteStyle: ShadowContainerStyle = {
  '--shadow-host-background-color': 'white',
  '--shadow-host-border': '0.5px solid var(--color-code-background)',
  '--shadow-host-border-radius': '8px'
}

export const ShadowWhiteContainer = ({ style, ref, ...props }: DivProps) =>
  React.createElement('div', {
    ref,
    style: { ...shadowWhiteStyle, ...style },
    ...props
  })

ShadowWhiteContainer.displayName = 'ShadowWhiteContainer'

const shadowTransparentStyle: ShadowContainerStyle = {
  '--shadow-host-background-color': 'transparent',
  '--shadow-host-border': 'unset',
  '--shadow-host-border-radius': 'unset'
}

export const ShadowTransparentContainer = ({ style, ref, ...props }: DivProps) =>
  React.createElement('div', {
    ref,
    style: { ...shadowTransparentStyle, ...style },
    ...props
  })

ShadowTransparentContainer.displayName = 'ShadowTransparentContainer'
