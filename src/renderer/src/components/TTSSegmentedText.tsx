import { Spin } from 'antd'
import React from 'react'
import styled from 'styled-components'

interface TTSSegmentedTextProps {
  segments: {
    text: string
    isLoaded: boolean
    isLoading: boolean
  }[]
  currentSegmentIndex: number
  isPlaying: boolean
  onSegmentClick: (index: number) => void
}

const TTSSegmentedText: React.FC<TTSSegmentedTextProps> = ({
  segments,
  currentSegmentIndex,
  // isPlaying, // 未使用的参数
  onSegmentClick
}) => {
  if (!segments || segments.length === 0) {
    return null
  }

  return (
    <SegmentedTextContainer>
      {segments.map((segment, index) => (
        <Segment
          key={index}
          className={`${index === currentSegmentIndex ? 'active' : ''}`}
          onClick={() => onSegmentClick(index)}>
          <SegmentText>{segment.text}</SegmentText>
          {segment.isLoading && <Spin size="small" className="segment-loading" />}
        </Segment>
      ))}
    </SegmentedTextContainer>
  )
}

const SegmentedTextContainer = styled.div`
  margin: 10px 0;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  max-height: 300px;
  overflow-y: auto;
`

const Segment = styled.div`
  padding: 5px;
  margin: 2px 0;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;

  &:hover {
    background-color: var(--color-background-soft);
  }

  &.active {
    background-color: var(--color-primary-bg);
    border-left: 3px solid var(--color-primary);
  }

  .segment-loading {
    margin-left: 5px;
  }
`

const SegmentText = styled.span`
  flex: 1;
`

export default TTSSegmentedText
