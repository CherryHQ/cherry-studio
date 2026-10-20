import { unsupported } from './unsupported'

// Stand-in for the native `sharp` image library. Token counting falls back to its default
// image cost when the measurement throws.
export default unsupported('Image measurement')
