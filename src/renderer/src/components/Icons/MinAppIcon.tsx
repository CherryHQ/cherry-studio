import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { MinAppType } from '@renderer/types'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  size?: number
  style?: React.CSSProperties
}

const MinAppIcon: FC<Props> = ({ app, size = 48, style }) => {
  const _app = DEFAULT_MIN_APPS.find((item) => item.id === app.id)

  if (!_app) {
    return null
  }

  return (
    <Container
      src={_app.logo}
      style={{
        border: _app.bodered ? '0.5px solid var(--color-border)' : 'none',
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: _app.background,
        ...app.style,
        ...style
      }}
    />
  )
}

const Container = styled.img`
  border-radius: 16px;
  user-select: none;
  -webkit-user-drag: none;
`

export default MinAppIcon
