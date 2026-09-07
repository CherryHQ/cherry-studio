import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const RADEON_CLOUD_LOGO_DATA_URI = [
  'data:image/png;base64,',
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAAdCAYAAABhXag7AAAIPUlEQVR42u2baaxdVRXHf2d4',
  'z1cqKGKxKhKoGGKiICE1ERGNgBpSQ+JDILEBE9AAaaykxhinLzjhEFAJGi0gBQGHkJaElFGZ',
  'AoJDCFOoVlqpPASiVNu+vuHec/xw/0uWmzPf92794El2zn33nrPP2uu/1/Rf58H/5hF1vC8e',
  'kWypRtTinhh4DfAgkAPzOi/qaKPI10vIvGBhzwJZB0W9Dkg0p333d2BGn/OW4GbAq4GlwZwz',
  'mtcfBwD7l6zHHzZPD9gNTAe/J3pu3mC9ObAc2Ay8Q3Om+9KSEgl2HLBHYxrYq7FL50/o+rSF',
  'de4HPKX7p93cvxdIbSwy0floYMrNtVvz3+zmMxm/FqyhbuwCngEeAtYDHwMOLpChiYd5LfDw',
  'iCy5keKu0sVZySSPt3BZHuC/lcx3m56dNJjTlLYc2F4y350FAH+rZk1NxgvApcAhLUC2aw4G',
  'Hh0ByLVALAN2ShF9nf3oaaJTGi7SA/xMwbxzmu/HDbyCxbYJ4AGnLJvLPt9WAPA33fP8evr6',
  'LhzzWmvPfTYlPg+s7gDycuCxRQa59DBFXFAjgH1/a0O36gGeKrEiA/nzunasItkB+FmJjAbC',
  '7SUAd1Gs39RZcP8XW4QqA/kNwBNOln7LUSlvlSB9KfGcgszWJyap/j4ROEpuJ9H9XY9USvwq',
  'sA243n3nr5kHLgZO1+exIZ6ZaQM8Adyk+TOtcz/gTcDbgBVufYm7LgMuAv4BXN5AB3b/FHCy',
  'wsiRo0yuAN4l8Op2ynzgVpMhLTh37nIWeHdgGXY+r8YK21iwnddXyD4BnATcEczvLXsOeLsL',
  'H011fShwP/Anja0Nx94uLtoeuj5YvAF9JfCcW5iNf6mcqlpcU4D9854DDtd94zp/yCk1W0CA',
  'f6prXuHq3bRg015cALJ9vqVlFRAHuo9dklk2TKbfFMhRCbABcBDwYgGIc/rtuiAG2fkLNXGo',
  'CcD9AqU9Chyoe48C/umsPC/xNF0AvqbCC0VOwQA/L1CuJYzHtMhJIoWXwzt42weqAI4rrPej',
  'qkd7EsCIjLtEGlwbWKqdPwkscTG8KyOVOXl6in8bgLcAm0RUZO65+QiYrNzF1QhYp5o7dtZi',
  'cfuMBgBH7t4N0rmBHdWMuIl+45bJVaSaOFJS8KQDI9a9hwIfkdBJByX2lOh4kC2RWQX8Djgs',
  'mN+U+njAPi3W0Zd8O1SCeQMwfb3XXVsFbl+19JnOYy4YkREXWG8OvBM4VkInTpnPO1ZoFrjC',
  'Kdjv8rXBottYSKLkabPk6zlZc1muz+J7+u0i4JIapS40Jx3Jo/lNZTpdUUGFenC/K31lHQ2i',
  'FcAmyLkBQKawjUqkLI5dKzowdeDkwErgPR2ENmXMakdvd9br+VwPbqoY+2UpdFSHWdC2kgbJ',
  'q9RcKPKCVkJdAnxKXPmihJc4eHBPQk0G8diuu8ZZbCKqcWOwCQyMtUPI9UptpFN1LnKBfYH7',
  'mOrgaDEsoMExXQJw6jL+ENwe8G3g04vdcIgLkqvTlK365CoGtgC/dZyzlQ/rg7nMilcpIco6',
  '7E579iOyZIKYYxvsBW2CnS4bH/WxtCTu95WZh265pxJr3Si6SXGD5MqUdplcp/Gx9vlu4F4X',
  'UyKdx4Hzh8huc9Wim4E1zq1ljs6cVEdqYh8AazH4iBKAd2nj+dDTB74OfJYRtQpTZ3V9xc6V',
  'Qez0SdapJSXMU4q5YbJ2FvAVZYdt+7s+xl6upGWdgB0HPq6NFVKYo47B7w8MwsDcoVrdu+UL',
  'gc8tAK3aGmA7znE7LQ4Ev7QF7Wbx/CB1Wb43BBAWaz+j8mgS+JISvJR90zS3Jv+bxcF7L2Ul',
  'mzFMXraV7veq0ilu6PUalUkG6IGKvyGL4xmaXskoeqPBypoLtFu7Eh+eXFgNnCCvEO8Dy41c',
  'xZBr008EoJlOf1kAwnQNcLMUtzDLRi3QqXMfk7K4fgBw1KCBUMVGHcmgV7xJz+t3BBmVE/d2',
  'rLHbghi+bOA3OfJKqwJ92eeHVR/HzgPRgJ9fIRq2zNuZMdrLEk+7DZXXJVoPlnCaGYOOxUzN',
  '2FvAK9tcvwp2dxkXbVzyCSWbqqwUMgVeGPDKXbjoKyrAX8KgyXE3xd0k62OfFMhvz7yS4Zr7',
  'pqftwFu1nuNdFfGyrp+RCMcqPnj6z5KF0xm8h5RUWE0ioU8BfuhKI7vnfXrGH5zHGJYLXqyK',
  '4jjgOy5RzOWGD2HQBjwssFYc2GPANxi0E5MFltVyje1K7Lbp7/uk980F/Px/ju9T3BZ8sqUQ',
  'Y8BfgjlszquD3dzFguuSxWEsuOnoU/5Gx2VO7qhAvq4WPO8s94gS73C8SKH/suSYQcfoNJcJ',
  'eiu5TufxILsrGuMSZIPb4bmLxZPAGwPr7USgNyxfmsxZ5gbnS0bYFrR4/aKSyTVuvQvV8LAY',
  'voPBmx9bA+/Qc5a8ipe6W5nt6NUMXv7yLagxXXCDm6QuozPgfuLclZ9zqYgPn1SkwTWJIxCG',
  'IR/S4JxUVBApL2/DjZUMS77sPCU++RjgB4sEbsLg5cSTGbzpUZSoGsj3CGTL1rMUOFtfeLYl',
  'BX4N/DEgNqoO8/1/Bm4EPqwHJ27uM+QajV/eLd45DxoJXWPXvJK9nov/ib4rKkn8tXVrm5Gl',
  'Pq0s+R6NnQFZtFCHyf6swN1SwyWYUd0l3d8MTERym2FNFQmEPS0ZKLO8Cbn+sFUWiz+e0/fL',
  'Cmpu+++GuY688AEFG2aWwctw/tg/2Fx1ljQr+jErSDDreHAD5ioxcP2aTWUy/RX4IIP+eFOi',
  'yK77APAL/n90yraL6uQmSeCP5GX2aMMUjRmdp3jptZ+2TJ1df+K/AbPEWZo3P+xMAAAAAElF',
  'TkSuQmCC'
].join('')

const RadeonCloudLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <rect width={120} height={120} fill="#fff" rx={24} />
    <image href={RADEON_CLOUD_LOGO_DATA_URI} x={14} y={49} width={92} height={22} preserveAspectRatio="xMidYMid meet" />
  </svg>
)

export { RadeonCloudLight }
export default RadeonCloudLight
