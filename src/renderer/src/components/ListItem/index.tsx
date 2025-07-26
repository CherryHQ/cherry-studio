import { Typography } from 'antd'
import { ReactNode } from 'react'
import styled from 'styled-components'

interface ListItemProps {
  active?: boolean
  icon?: ReactNode
  title: ReactNode
  subtitle?: string
  titleStyle?: React.CSSProperties
  onClick?: () => void
  rightContent?: ReactNode
  style?: React.CSSProperties
}

const ListItem = ({ active, icon, title, subtitle, titleStyle, onClick, rightContent, style }: ListItemProps) => {
  return (
    <ListItemContainer className={active ? 'active' : ''} onClick={onClick} style={style}>
      <ListItemContent>
        {icon && <IconWrapper>{icon}</IconWrapper>}
        <TextContainer>
          <Typography.Text style={titleStyle} ellipsis={{ expanded: false, tooltip: title }}>
            {title}
          </Typography.Text>
          {subtitle && <SubtitleText>{subtitle}</SubtitleText>}
        </TextContainer>
        {rightContent && <RightContentWrapper>{rightContent}</RightContentWrapper>}
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
  gap: 2px;
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
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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

const RightContentWrapper = styled.div`
  margin-left: auto;
`

export default ListItem
