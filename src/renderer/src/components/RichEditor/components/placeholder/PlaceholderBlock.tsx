import { useTheme } from '@renderer/context/ThemeProvider'
import React from 'react'

interface PlaceholderBlockProps {
  /** Icon element to display */
  icon: React.ReactNode
  /** Localised message */
  message: string
  /** Click handler */
  onClick: () => void
}

/**
 * Reusable placeholder block for TipTap NodeViews (math / image etc.)
 * Handles dark-mode colours and simple hover feedback.
 */
const PlaceholderBlock: React.FC<PlaceholderBlockProps> = ({ icon, message, onClick }) => {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const colors = {
    border: isDark ? 'var(--color-border, #ffffff19)' : '#d0d7de',
    background: isDark ? 'var(--color-background-soft, #222222)' : 'var(--color-canvas-subtle, #f6f8fa)',
    hoverBorder: isDark ? 'var(--color-primary, #2f81f7)' : '#0969da',
    hoverBackground: isDark ? 'rgba(56, 139, 253, 0.15)' : 'var(--color-accent-subtle, #ddf4ff)'
  }

  return (
    <div
      onClick={onClick}
      style={{
        border: `2px dashed ${colors.border}`,
        borderRadius: 6,
        padding: 24,
        margin: '8px 0',
        textAlign: 'center',
        cursor: 'pointer',
        background: colors.background,
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 80
      }}
      onMouseEnter={(e) => {
        const target = e.currentTarget as HTMLElement
        target.style.borderColor = colors.hoverBorder
        target.style.backgroundColor = colors.hoverBackground
      }}
      onMouseLeave={(e) => {
        const target = e.currentTarget as HTMLElement
        target.style.borderColor = colors.border
        target.style.backgroundColor = colors.background
      }}>
      {icon}
      <span style={{ color: '#656d76', fontSize: 14 }}>{message}</span>
    </div>
  )
}

export default PlaceholderBlock
