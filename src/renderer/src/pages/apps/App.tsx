import MinApp from '@renderer/components/MinApp'
import { MinAppType } from '@renderer/types'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  onClick?: () => void
  size?: number
}

const App: FC<Props> = ({ app, onClick, size = 60 }) => {
  const handleClick = () => {
    MinApp.start(app)
    onClick?.()
  }

  return (
    <Container onClick={handleClick}>
      <AppIcon
        src={app.logo}
        style={{
          border: app.bodered ? '0.5px solid var(--color-border)' : 'none',
          width: `${size}px`,
          height: `${size}px`
        }}
      />
      <AppTitle>{app.name}</AppTitle>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
`

const AppIcon = styled.img`
  border-radius: 16px;
  user-select: none;
  -webkit-user-drag: none;
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

export default App
