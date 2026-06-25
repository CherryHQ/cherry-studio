import AnimatedRevealText from '@renderer/components/AnimatedRevealText'

interface ConversationHomeWelcomeProps {
  text: string
}

export default function ConversationHomeWelcome({ text }: ConversationHomeWelcomeProps) {
  return <AnimatedRevealText text={text} />
}
