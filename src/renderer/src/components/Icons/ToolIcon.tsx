import { FC } from 'react'

const ToolIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  return <i {...props} className={`iconfont icon-plugin ${props.className}`} />
}

export default ToolIcon
