import { ReactNode } from 'react'
import styled from 'styled-components'

interface ListItemProps {
  active?: boolean
  icon?: ReactNode
  title: string
  subtitle?: string
  titleStyle?: React.CSSProperties
  onClick?: () => void
}

const ListItem = ({ active, icon, title, subtitle, titleStyle, onClick }: ListItemProps) => {
  return (
    <ListItemContainer className={active ? 'active' : ''} onClick={onClick}>
      <ListItemContent>
        {icon && <IconWrapper>{icon}</IconWrapper>}
        <TextContainer>
          <TitleText style={titleStyle}>{title}</TitleText>
          {subtitle && <SubtitleText>{subtitle}</SubtitleText>}
        </TextContainer>
      </ListItemContent>
    </ListItemContainer>
  )
}

const ListItemContainer = styled.div`
  padding: 7px 12px;
  border-radius: var(--list-item-border-radius);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  font-family: Ubuntu;
  cursor: pointer;
  border: 1px solid transparent;

  &:hover {
    background-color: var(--color-background-soft);
  }

  &.active {
    background-color: var(--color-background-soft);
    border: 1px solid var(--color-border-soft);
  }
`

const ListItemContent = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  font-size: 13px;
`

const IconWrapper = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
`

const TextContainer = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const TitleText = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const SubtitleText = styled.div`
  font-size: 10px;
  color: var(--color-text-soft);
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--color-text-3);
`

export default ListItem
