import { Tooltip } from '@cherrystudio/ui'
import { Copy } from 'lucide-react'
import type { FC, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface CopyButtonProps {
  tooltip?: string
  textToCopy: string
  label?: string
  color?: string
  hoverColor?: string
  size?: number
}

interface ButtonContainerProps {
  $color: string
  $hoverColor: string
}

const CopyButton: FC<CopyButtonProps> = ({
  tooltip,
  textToCopy,
  label,
  color = 'var(--color-text-2)',
  hoverColor = 'var(--color-primary)',
  size = 14
}) => {
  const { t } = useTranslation()

  const handleCopy = () => {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        window.toast?.success(t('message.copy.success'))
      })
      .catch(() => {
        window.toast?.error(t('message.copy.failed'))
      })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleCopy()
    }
  }

  const ariaLabel = tooltip || t('common.copy')

  const button = (
    <ButtonContainer
      $color={color}
      $hoverColor={hoverColor}
      onClick={handleCopy}
      onKeyDown={handleKeyDown}
      role="button"
      aria-label={ariaLabel}
      tabIndex={0}>
      <Copy size={size} className="copy-icon" />
      {label && <RightText size={size}>{label}</RightText>}
    </ButtonContainer>
  )

  if (tooltip) {
    return <Tooltip content={tooltip}>{button}</Tooltip>
  }

  return button
}

const ButtonContainer = styled.div<ButtonContainerProps>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: ${(props) => props.$color};
  transition: color 0.2s;

  .copy-icon {
    color: ${(props) => props.$color};
    transition: color 0.2s;
  }

  &:hover {
    color: ${(props) => props.$hoverColor};

    .copy-icon {
      color: ${(props) => props.$hoverColor};
    }
  }
`

const RightText = styled.span<{ size: number }>`
  font-size: ${(props) => props.size}px;
`

export default CopyButton
