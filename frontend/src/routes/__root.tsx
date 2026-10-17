import React, { useEffect, useState } from 'react'
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyDev<P = any>(factory: () => Promise<React.ComponentType<P>>): React.ComponentType<P> {
  return import.meta.env.DEV
    ? React.lazy(() => factory().then(c => ({ default: c })))
    : ((() => null) as React.ComponentType<P>)
}

const ReactQueryDevtools = lazyDev(() =>
  import('@tanstack/react-query-devtools').then(m => m.ReactQueryDevtools)
)
const TanStackDevtools = lazyDev(() =>
  import('@tanstack/react-devtools').then(m => m.TanStackDevtools)
)
const TanStackRouterDevtoolsPanel = lazyDev(() =>
  import('@tanstack/react-router-devtools').then(m => m.TanStackRouterDevtoolsPanel)
)

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { THEME_SCRIPT } from '@/lib/theme'
import { AuthProvider } from '@/contexts/AuthContext'
import { initWebVitals } from '@/lib/web-vitals'
import { useDevtoolsEnabled } from '@/hooks/useDevtoolsEnabled'
import { PRODUCT_NAME } from '@/lib/brand'

import appCss from '@/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: PRODUCT_NAME,
      },
      {
        name: 'description',
        content: `${PRODUCT_NAME} is an open-source Notion alternative for docs, wikis and databases.`,
      },
      {
        name: 'theme-color',
        content: '#ffffff',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/favicon.svg',
        type: 'image/svg+xml',
      },
      {
        rel: 'icon',
        href: '/favicon.ico',
        sizes: '32x32',
      },
    ],
    // Sets the theme class before the first paint, so a dark-theme user sees no white flash.
    scripts: [{ children: THEME_SCRIPT }],
  }),

  shellComponent: RootDocument,
})

function RootDocument() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  useEffect(() => {
    initWebVitals()
  }, [])

  // The floating devtools buttons sit on top of the app (sidebar, bottom corners): opt in only.
  const devtools = useDevtoolsEnabled()

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <TooltipProvider>
              <AuthProvider queryClient={queryClient}>
                <ErrorBoundary>
                  <Outlet />
                </ErrorBoundary>
                <Toaster />
                {devtools && (
                  <React.Suspense>
                    <ReactQueryDevtools initialIsOpen={false} />
                    <TanStackDevtools
                      config={{
                        position: 'bottom-right',
                      }}
                      plugins={[
                        {
                          name: 'Tanstack Router',
                          render: <TanStackRouterDevtoolsPanel />,
                        },
                      ]}
                    />
                  </React.Suspense>
                )}
              </AuthProvider>
            </TooltipProvider>
          </ThemeProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
