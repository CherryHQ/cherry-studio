import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import type { AttachedSkill } from '@renderer/types'
import { Zap } from 'lucide-react'
import type { FC } from 'react'
import styled from 'styled-components'

const SkillsInput: FC<{
  attachedSkills: AttachedSkill[]
  onRemoveSkill: (skill: AttachedSkill) => void
}> = ({ attachedSkills, onRemoveSkill }) => {
  return (
    <Container>
      <HorizontalScrollContainer dependencies={[attachedSkills]} expandable>
        {attachedSkills.map((skill) => (
          <CustomTag
            key={skill.folderName}
            icon={<Zap size={14} />}
            color="#37a5aa"
            tooltip={skill.description}
            closable
            onClose={() => onRemoveSkill(skill)}>
            {skill.name || skill.folderName}
          </CustomTag>
        ))}
      </HorizontalScrollContainer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
`

export default SkillsInput
