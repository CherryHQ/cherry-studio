import { type SVGProps, useId } from 'react'

const IflowCli = (props: SVGProps<SVGSVGElement>) => {
  const id = useId().replace(/:/g, '')
  const clipPathId = `${id}-iflowcli-a`
  const gradientBId = `${id}-iflowcli-b`
  const gradientCId = `${id}-iflowcli-c`
  const gradientDId = `${id}-iflowcli-d`
  const gradientEId = `${id}-iflowcli-e`

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
      <g clipPath={`url(#${clipPathId})`}>
        <path
          fill={`url(#${gradientBId})`}
          d="M103 56.1338C102.304 46.1544 98.1592 36.7277 91.2752 29.4694C84.3911 22.2112 75.1968 17.5734 65.2681 16.351C55.3395 15.1287 45.2948 17.3979 36.8558 22.7696C28.4168 28.1414 22.1091 36.2813 19.0138 45.794C17.3581 50.8963 21.1298 56.1338 26.4939 56.1338C28.1438 56.1347 29.7524 55.6171 31.0921 54.654C32.4318 53.6909 33.4349 52.3311 33.9596 50.7668C36.8035 42.2668 44.9799 26.6678 66.6709 26.6678C96.4821 26.6678 103 56.1338 103 56.1338Z"
        />
        <path
          fill={`url(#${gradientCId})`}
          d="M47.3678 49.2866H42.6481C41.868 49.2866 41.2355 49.9191 41.2355 50.6992V64.057C41.2355 64.8372 41.868 65.4696 42.6481 65.4696H47.3678C48.148 65.4696 48.7804 64.8372 48.7804 64.057V50.6992C48.7804 49.9191 48.148 49.2866 47.3678 49.2866Z"
        />
        <path
          fill={`url(#${gradientDId})`}
          d="M69.5147 49.2866H64.795C64.0149 49.2866 63.3824 49.9191 63.3824 50.6992V64.057C63.3824 64.8372 64.0149 65.4696 64.795 65.4696H69.5147C70.2949 65.4696 70.9273 64.8372 70.9273 64.057V50.6992C70.9273 49.9191 70.2949 49.2866 69.5147 49.2866Z"
        />
        <path
          fill={`url(#${gradientEId})`}
          d="M53.3275 92.3406C75.0184 92.3406 83.1948 76.7416 86.0401 68.243C86.5647 66.6786 87.5678 65.3187 88.9075 64.3556C90.2472 63.3925 91.8559 62.8749 93.5059 62.876C98.8685 62.876 102.642 68.1121 100.986 73.2144C99.4902 77.8389 97.2164 82.1744 94.2625 86.0342L98.3622 98.2441L83.7817 95.8505C77.4969 100.011 70.2309 102.45 62.7089 102.925C55.1869 103.4 47.6718 101.894 40.9137 98.5567C34.1557 95.2198 28.3909 90.1689 24.1947 83.908C19.9986 77.6471 17.5178 70.3952 16.9999 62.876C16.9999 62.876 23.5177 92.3406 53.3275 92.3406Z"
        />
      </g>
      <defs>
        <linearGradient id={gradientBId} x1={101.041} x2={33.649} y1={4.814} y2={77.575} gradientUnits="userSpaceOnUse">
          <stop offset={0.32} stopColor="#A25CFF" />
          <stop offset={1} stopColor="#2B52F0" />
        </linearGradient>
        <linearGradient id={gradientCId} x1={96.226} x2={17.613} y1={9.938} y2={82.752} gradientUnits="userSpaceOnUse">
          <stop offset={0.32} stopColor="#A25CFF" />
          <stop offset={1} stopColor="#2B52F0" />
        </linearGradient>
        <linearGradient id={gradientDId} x1={106.452} x2={27.84} y1={20.979} y2={93.792} gradientUnits="userSpaceOnUse">
          <stop offset={0.32} stopColor="#A25CFF" />
          <stop offset={1} stopColor="#2B52F0" />
        </linearGradient>
        <linearGradient
          id={gradientEId}
          x1={111.215}
          x2={50.508}
          y1={30.977}
          y2={87.205}
          gradientUnits="userSpaceOnUse">
          <stop offset={0.32} stopColor="#A25CFF" />
          <stop offset={1} stopColor="#2B52F0" />
        </linearGradient>
        <clipPath id={clipPathId}>
          <path fill="#fff" d="M0 0H86V87.008H0z" transform="translate(17 16)" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { IflowCli }
export default IflowCli
