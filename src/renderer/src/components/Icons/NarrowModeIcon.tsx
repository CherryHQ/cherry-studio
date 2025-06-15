import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  isNarrowMode: boolean
}

const NarrowModeIcon: FC<Props> = ({ isNarrowMode }) => {
  return (
    <Container $isNarrowMode={isNarrowMode}>
      <Line />
      <Line />
    </Container>
  )
}

const Container = styled.div<{ $isNarrowMode: boolean }>`
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--color-text-2);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: ${({ $isNarrowMode }) => ($isNarrowMode ? 'space-evenly' : 'space-between')};
  padding: 2px;
`

const Line = styled.div`
  width: 2px;
  height: 10px;
  background-color: var(--color-text-2);
  border-radius: 5px;
`

export default NarrowModeIcon
