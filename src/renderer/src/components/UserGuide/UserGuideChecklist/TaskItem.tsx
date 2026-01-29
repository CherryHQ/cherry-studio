import { Check } from 'lucide-react'
import type { FC } from 'react'

import { Checkbox, TaskItemContainer, TaskText } from './styles'

interface TaskItemProps {
  label: string
  completed: boolean
  onClick?: () => void
}

const TaskItem: FC<TaskItemProps> = ({ label, completed, onClick }) => {
  return (
    <TaskItemContainer $completed={completed} onClick={onClick}>
      <Checkbox $checked={completed}>{completed && <Check size={12} color="white" strokeWidth={3} />}</Checkbox>
      <TaskText $completed={completed}>{label}</TaskText>
    </TaskItemContainer>
  )
}

export default TaskItem
