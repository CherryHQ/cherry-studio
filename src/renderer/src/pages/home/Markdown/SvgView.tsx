interface Props {
  children: string
}

const SvgView: React.FC<Props> = ({ children }) => {
  return (
    <div
      dangerouslySetInnerHTML={{ __html: children }}
      style={{
        padding: '1em',
        backgroundColor: 'white',
        border: '0.5px solid var(--color-code-background)',
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0
      }}
    />
  )
}

export default SvgView
