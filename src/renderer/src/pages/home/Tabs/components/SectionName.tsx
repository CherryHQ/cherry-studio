type Props = {
  name: string
}

export const SectionName: React.FC<Props> = ({ name }) => {
  return <div className="mb-2 text-gray-500 text-sm">{name}</div>
}
