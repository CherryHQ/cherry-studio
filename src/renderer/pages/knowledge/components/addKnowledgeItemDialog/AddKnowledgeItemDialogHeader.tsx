import { KnowledgeDialogHeader } from '../KnowledgeDialogLayout'

interface AddKnowledgeItemDialogHeaderProps {
  title: string
}

const AddKnowledgeItemDialogHeader = ({ title }: AddKnowledgeItemDialogHeaderProps) => {
  return <KnowledgeDialogHeader>{title}</KnowledgeDialogHeader>
}

export default AddKnowledgeItemDialogHeader
