import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { PageHeader, pageColumnClass } from '@/components/PageHeader'
import { PageSkeleton } from '@/components/PageSkeleton'
import { PageTopbar } from '@/components/PageTopbar'
import { Topbar } from '@/components/Topbar'
import { TrashBanner } from '@/components/TrashBanner'
import { CommentsPanel } from '@/components/CommentsPanel'
import { buttonVariants } from '@/components/ui/button'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { PageEditorProvider } from '@/contexts/PageEditorContext'
import { useCollabSession } from '@/hooks/useCollabSession'
import { usePage } from '@/hooks/usePages'
import { ApiError } from '@/lib/api-client'
import { getErrorMessage } from '@/lib/error-handler'
import { pageLabel } from '@/features/pages/page-tree'
import { cn } from '@/lib/utils'
import { RowProperties } from '@/components/RowProperties'
import { usePageTree } from '@/hooks/usePages'
import type { PageResponse } from '@/types/page'

// The editor and the database views are big: load them when a page opens, never on the server.
const DocumentEditor = lazy(() =>
  import('@/components/DocumentEditor').then(module => ({ default: module.DocumentEditor }))
)
const DatabaseView = lazy(() =>
  import('@/components/DatabaseView').then(module => ({ default: module.DatabaseView }))
)

function BodySkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse space-y-3 pt-2">
      <div className="bg-hover h-4 w-full rounded-[3px]" />
      <div className="bg-hover h-4 w-4/5 rounded-[3px]" />
    </div>
  )
}

function NotFound({ message }: { message: string }) {
  return (
    <>
      <Topbar title="Page" />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-24 text-center">
        <div className="text-[56px] leading-none">🔍</div>
        <h1 className="text-[20px] font-semibold">Page not found</h1>
        <p className="text-muted-foreground max-w-[420px] text-[14px]">{message}</p>
        <Link to="/home" className={cn(buttonVariants({ variant: 'outline' }), 'mt-2')}>
          Back to home
        </Link>
      </div>
    </>
  )
}

function LoadedPage({ page }: { page: PageResponse }) {
  const { canEdit, workspace } = useWorkspace()
  const { data: tree } = usePageTree(workspace.id)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const session = useCollabSession(page.id)
  const trashed = page.deleted_at !== null
  const editable = canEdit && page.role !== 'viewer' && !trashed && !page.locked
  const isDatabase = page.kind === 'database'
  // A page whose parent is a database is a row of it: its properties show above the editor.
  const parent = tree?.find(item => item.id === page.parent_id)
  const databaseId = parent?.kind === 'database' ? parent.id : null

  useEffect(() => {
    document.title = `${page.icon ? `${page.icon} ` : ''}${pageLabel(page)} | Notion`
    return () => {
      document.title = 'Notion'
    }
  }, [page])

  return (
    <PageEditorProvider>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <PageTopbar
            page={page}
            users={session?.users ?? []}
            status={session?.status ?? 'connecting'}
            commentsOpen={commentsOpen}
            onToggleComments={() => setCommentsOpen(open => !open)}
          />
          {trashed && <TrashBanner page={page} />}
          <div
            data-testid="page-scroll"
            data-font={page.font}
            className={cn(
              'nx-scroll min-h-0 flex-1 overflow-y-auto',
              page.font === 'serif' && 'font-serif',
              page.font === 'mono' && 'font-mono'
            )}
          >
            <PageHeader page={page} editable={editable} commentsOpen={commentsOpen} />
            <Suspense
              fallback={
                <div className={pageColumnClass(page)}>
                  <BodySkeleton />
                </div>
              }
            >
              {isDatabase ? (
                <DatabaseView page={page} editable={editable} />
              ) : (
                <>
                  {databaseId && (
                    <RowProperties page={page} databaseId={databaseId} editable={editable} />
                  )}
                  <div className={cn(pageColumnClass(page), !editable && 'pb-[20vh]')}>
                    <DocumentEditor page={page} session={session} editable={editable} />
                  </div>
                </>
              )}
            </Suspense>
          </div>
        </div>
        {commentsOpen && <CommentsPanel pageId={page.id} onClose={() => setCommentsOpen(false)} />}
      </div>
    </PageEditorProvider>
  )
}

/** One page: loads it, then shows the page or database with its top bar. */
export function PageView({ pageId }: { pageId: string }) {
  const { data: page, error, isPending } = usePage(pageId)
  const { workspace, setWorkspaceId } = useWorkspace()

  // A link to a page of another workspace of mine opens that workspace.
  useEffect(() => {
    if (page && page.workspace_id !== workspace.id) setWorkspaceId(page.workspace_id)
  }, [page, workspace.id, setWorkspaceId])

  if (isPending) {
    return (
      <>
        <Topbar title="" />
        <PageSkeleton />
      </>
    )
  }
  if (error && !page) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <NotFound
        message={
          missing
            ? "This page doesn't exist, or you don't have access to it."
            : getErrorMessage(error, 'Something went wrong while loading the page.')
        }
      />
    )
  }
  return <LoadedPage page={page!} />
}
