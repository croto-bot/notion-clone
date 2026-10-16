import { useEffect } from 'react'
import { createFileRoute, Outlet, useRouter } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import { WorkspaceProvider } from '@/contexts/WorkspaceContext'

/**
 * Layout for pages that need a signed-in user: put them in routes/_authed/.
 * The URL does not change (routes/_authed/home.tsx is /home).
 *
 * Anonymous visitors go to /login?redirect=<page> and come back after signing
 * in. This also happens when the session ends while the page is open.
 *
 * The check runs in the browser after hydration (ssr: false, and an effect
 * instead of beforeLoad): the session token is in localStorage, which the
 * server cannot read, and a redirect during hydration breaks it.
 *
 * Signed in, the page shows inside the app shell (sidebar + page) of the
 * current workspace.
 */
export const Route = createFileRoute('/_authed')({
  ssr: false,
  component: RequireAuth,
})

function RequireAuth() {
  const { isAuthenticated } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isAuthenticated) return
    const { location } = router.state
    // This layout can render again while the redirect is pending: go only once.
    if (location.pathname === '/login') return
    router.navigate({ to: '/login', search: { redirect: location.href }, replace: true })
  }, [isAuthenticated, router])

  if (!isAuthenticated) return null
  return (
    <WorkspaceProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  )
}
