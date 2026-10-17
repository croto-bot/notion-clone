import { lazy, Suspense, useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { NotionLogo } from '@/components/NotionLogo'
import { PageIcon } from '@/components/PageIcon'
import { PageSkeleton } from '@/components/PageSkeleton'
import { pageColumnClass } from '@/components/PageHeader'
import { buttonVariants } from '@/components/ui/button'
import { PRODUCT_NAME } from '@/lib/brand'
import { useAuth } from '@/contexts/AuthContext'
import { usePublicPage } from '@/hooks/usePublicPage'
import type { PageLinkResolver } from '@/features/editor/page-link-context'
import { pageLabel } from '@/features/pages/page-tree'
import { coverBackground, isRenderableCover } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { PublicPage } from '@/types/public-page'

// The editor needs the browser: it is loaded only on the client (this route is ssr: false).
const PublicEditor = lazy(() =>
  import('@/components/PublicEditor').then(module => ({ default: module.PublicEditor }))
)
const PublicDatabase = lazy(() =>
  import('@/components/PublicDatabase').then(module => ({ default: module.PublicDatabase }))
)

/** A published page, read-only, for anyone with the link. */
export const Route = createFileRoute('/share/$publicId')({
  ssr: false,
  component: SharePage,
})

function ShareHeader({ title }: { title: string }) {
  const { isAuthenticated } = useAuth()
  return (
    <header className="bg-background/90 sticky top-0 z-20 flex h-[45px] items-center gap-2 px-3 backdrop-blur">
      <Link to="/" aria-label={`${PRODUCT_NAME} home`} className="flex min-w-0 items-center gap-2">
        <NotionLogo size={22} />
        <span className="truncate text-[14px] font-medium">{title}</span>
      </Link>
      <div className="ml-auto flex items-center gap-1.5">
        {isAuthenticated ? (
          <Link to="/home" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Open {PRODUCT_NAME}
          </Link>
        ) : (
          <>
            <Link to="/login" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
              Log in
            </Link>
            <Link to="/register" className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}>
              Get {PRODUCT_NAME} free
            </Link>
          </>
        )}
      </div>
    </header>
  )
}

function PublicBody({ page }: { page: PublicPage }) {
  const resolvePage = useMemo<PageLinkResolver>(() => {
    const byId = new Map(page.children.map(child => [child.id, child]))
    return id => {
      const child = byId.get(id)
      if (!child) return undefined
      return {
        title: child.title,
        icon: child.icon,
        kind: 'page',
        href: { to: '/share/$publicId', params: { publicId: child.public_id } },
      }
    }
  }, [page.children])

  if (page.kind === 'database') return <PublicDatabase page={page} />
  return <PublicEditor state={page.state} resolvePage={resolvePage} smallText={page.small_text} />
}

function SharePage() {
  const { publicId } = Route.useParams()
  const { data: page, isPending, isError } = usePublicPage(publicId)

  if (isPending) {
    return (
      <div className="bg-background min-h-screen">
        <ShareHeader title={PRODUCT_NAME} />
        <PageSkeleton />
      </div>
    )
  }
  if (isError || !page) {
    return (
      <div className="bg-background min-h-screen">
        <ShareHeader title={PRODUCT_NAME} />
        <div className="flex flex-col items-center gap-3 px-6 pt-[18vh] text-center">
          <div className="text-[56px] leading-none">🔒</div>
          <h1 className="text-[20px] font-semibold">This page isn&apos;t available</h1>
          <p className="text-muted-foreground max-w-[420px] text-[14px]">
            It was never published, or its owner stopped sharing it.
          </p>
          <Link to="/" className={cn(buttonVariants({ variant: 'outline' }), 'mt-2')}>
            Go to {PRODUCT_NAME}
          </Link>
        </div>
      </div>
    )
  }

  const column = pageColumnClass(page)
  // The band and the icon strip's overlap follow the same predicate as the
  // editor's cover: a value that cannot render (from before the rule) shows
  // neither a band nor the overlap.
  const cover = isRenderableCover(page.cover) ? page.cover : null
  const hasCover = cover !== null
  return (
    <div
      className={cn(
        'bg-background text-foreground min-h-screen',
        page.font === 'serif' && 'font-serif',
        page.font === 'mono' && 'font-mono'
      )}
    >
      <ShareHeader title={pageLabel(page)} />
      {cover && (
        <div
          data-testid="page-cover"
          className="h-[30vh] w-full"
          style={coverBackground(cover, page.cover_position)}
        />
      )}
      <div className={column}>
        {page.icon ? (
          <div
            data-testid="page-icon"
            className={cn('relative z-10 size-[78px]', hasCover ? '-mt-[39px]' : 'mt-[56px]')}
          >
            <PageIcon icon={page.icon} size={78} emojiScale={1} />
          </div>
        ) : (
          <div className={hasCover ? 'h-[24px]' : 'h-[72px]'} />
        )}
        <h1 className="mt-4 text-[40px] leading-[1.2] font-bold tracking-[-0.01em] break-words">
          {page.title.trim() ? page.title : 'Untitled'}
        </h1>
        <div className="h-3" />
      </div>
      <div className={cn(column, 'pb-[20vh]')}>
        <Suspense
          fallback={
            <div className="animate-pulse space-y-3 py-1" aria-hidden="true">
              <div className="bg-hover h-5 w-full rounded-[3px]" />
              <div className="bg-hover h-5 w-5/6 rounded-[3px]" />
              <div className="bg-hover h-5 w-2/3 rounded-[3px]" />
            </div>
          }
        >
          <PublicBody page={page} />
        </Suspense>
      </div>
    </div>
  )
}
