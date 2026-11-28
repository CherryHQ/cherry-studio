import { KnowledgeDialogHeader } from '@renderer/components/knowledge/KnowledgeDialogLayout'

interface AddKnowledgeItemDialogHeaderProps {
  title: string
}

const AddKnowledgeItemDialogHeader = ({ title }: AddKnowledgeItemDialogHeaderProps) => {
  return <KnowledgeDialogHeader>{title}</KnowledgeDialogHeader>
}

export default AddKnowledgeItemDialogHeader
