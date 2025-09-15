import React from 'react'

type NoStyleProps<Tag extends keyof React.JSX.IntrinsicElements> = Omit<React.ComponentPropsWithoutRef<Tag>, 'style'>

function intrinsicFactory<Tag extends keyof React.JSX.IntrinsicElements>(tag: Tag) {
  return ({ ref, ...props }: NoStyleProps<Tag> & { ref?: React.RefObject<React.ComponentRef<Tag> | null> }) =>
    React.createElement(tag, { ...props, ref })
}

const createSemantic = () => {
  function semantic<T extends React.FC<any>>(component: T) {
    return ({ ref, ...props }: React.ComponentProps<T> & { ref?: React.RefObject<React.ComponentRef<T> | null> }) =>
      React.createElement(component, { ...props, ref })
  }
  // add more native html element here
  semantic.div = intrinsicFactory('div')
  semantic.span = intrinsicFactory('span')
  return semantic
}

export const semantic = createSemantic()
