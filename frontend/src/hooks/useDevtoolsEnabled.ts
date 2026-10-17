import { useSyncExternalStore } from 'react'

/** Set `localStorage['nx-devtools'] = '1'` in a dev build to show the TanStack devtools. */
export const DEVTOOLS_KEY = 'nx-devtools'

const subscribe = () => () => {}
const getSnapshot = () => import.meta.env.DEV && localStorage.getItem(DEVTOOLS_KEY) === '1'

/** False on the server and in production builds. */
export function useDevtoolsEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
