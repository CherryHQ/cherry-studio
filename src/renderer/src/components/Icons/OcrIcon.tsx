import { FC } from 'react'

const OcrIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  return <i {...props} className={`iconfont icon-OCRshibie ${props.className}`} />
}

export default OcrIcon
