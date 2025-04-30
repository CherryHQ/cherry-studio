import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import BarLoader from 'react-spinners/BarLoader'
import styled, { css } from 'styled-components'

interface Props {
  text: string
}

export default function Spinner({ text }: Props) {
  const { t } = useTranslation()
  return (
    <Container>
      <Search size={24} />
      <StatusText>{t(text)}</StatusText>
      <BarLoader color="#1677ff" />
    </Container>
  )
}

const baseContainer = css`
  display: flex;
  flex-direction: row;
  align-items: center;
`

const Container = styled.div`
  ${baseContainer}
  background-color: var(--color-background-mute);
  padding: 10px;
  border-radius: 10px;
  margin-bottom: 10px;
  gap: 10px;
`

const StatusText = styled.div`
  font-size: 14px;
  line-height: 1.6;
  text-decoration: none;
  color: var(--color-text-1);
`
