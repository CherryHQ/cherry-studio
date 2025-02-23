import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'

const NavigationHandler: React.FC = () => {
  const navigate = useNavigate()
  useHotkeys(
    'meta+, ! ctrl+,',
    function () {
      navigate('/settings/provider')
    },
    { splitKey: '!' }
  )

  return null
}

export default NavigationHandler
