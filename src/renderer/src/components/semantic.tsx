import React from "react"

type DistributiveOmit<T, K extends keyof T> = T extends any ? Omit<T, K> : never;

type IntrinsicProps<Tag extends keyof React.JSX.IntrinsicElements> =
  DistributiveOmit<React.JSX.IntrinsicElements[Tag], 'ref'>

type NoStyleProps<Tag extends keyof React.JSX.IntrinsicElements> =
  Omit<IntrinsicProps<Tag>, 'style'>

function intrinsicFactory<Tag extends keyof React.JSX.IntrinsicElements>(tag: Tag) {
  return React.forwardRef<
    React.ComponentRef<Tag>,
    NoStyleProps<Tag> & { children?: React.ReactNode }
  >((props, ref) => React.createElement(tag, { ...props, ref } as any));
}

export const semantic = {
  div: intrinsicFactory('div'),
  span: intrinsicFactory('span')
} as const

