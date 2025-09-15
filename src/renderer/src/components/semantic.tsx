import React from "react"

type NoStyleProps<Tag extends keyof React.JSX.IntrinsicElements> =
  Omit<React.ComponentPropsWithoutRef<Tag>, 'style'>;

function intrinsicFactory<Tag extends keyof React.JSX.IntrinsicElements>(tag: Tag) {
  return React.forwardRef<
    React.ComponentRef<Tag>,
    NoStyleProps<Tag>
  >((props, ref) => React.createElement(tag, { ...props, ref }));
}

const createSemantic = () => {
  function semantic<T extends React.FC>(component: T) {
    return React.forwardRef<
      React.ComponentRef<T>,
      React.ComponentProps<T>
    >((props, ref) => React.createElement(component, { ...props, ref }))
  }
  // add more native html element here
  semantic.div = intrinsicFactory('div')
  semantic.span = intrinsicFactory('span')
  return semantic
}

export const semantic = createSemantic()
