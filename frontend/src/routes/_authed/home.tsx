import { createFileRoute, Link } from '@tanstack/react-router'
import { Clock } from 'lucide-react'
import { Topbar } from '@/components/Topbar'
import { PageIcon } from '@/components/PageIcon'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useCurrentUser, displayNameOf } from '@/hooks/useUser'
import { useRecentPages } from '@/hooks/usePages'
import { pageLabel } from '@/features/pages/page-tree'
import { formatRelative, greeting } from '@/lib/time'
import { useNow } from '@/hooks/useNow'

export const Route = createFileRoute('/_authed/home')({
  component: HomePage,
})

function HomePage() {
  const { workspace } = useWorkspace()
  const { data: me } = useCurrentUser()
  const { data: recent = [], isLoading } = useRecentPages(workspace.id, 12)
  const now = useNow()

  return (
    <>
      <Topbar title="Home" />
      <div className="nx-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-6 pt-[72px] pb-24 md:px-12">
          <h1 className="text-center text-[30px] leading-tight font-semibold tracking-[-0.01em]">
            {me ? greeting(displayNameOf(me)) : 'Welcome'}
          </h1>

          <section aria-label="Recently visited" className="mt-12">
            <h2 className="text-muted-foreground mb-3 flex items-center gap-1.5 text-[13px] font-medium">
              <Clock className="size-4" />
              Recently visited
            </h2>
            {isLoading ? (
              <div className="bg-hover h-5 w-2/3 animate-pulse rounded-[3px]" aria-hidden="true" />
            ) : recent.length === 0 ? (
              <p className="text-muted-foreground text-[14px]">
                Pages you open show up here. Create one from the sidebar to get started.
              </p>
            ) : null}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {recent.map(page => (
                <li key={page.id}>
                  <Link
                    to="/p/$pageId"
                    params={{ pageId: page.id }}
                    className="bg-background hover:bg-hover group flex h-[120px] flex-col justify-between rounded-[8px] p-3 shadow-[0_0_0_1px_var(--border),0_1px_2px_rgba(15,15,15,0.04)] transition-[background-color,box-shadow,transform] duration-150 hover:shadow-[0_0_0_1px_var(--pressed),0_2px_6px_rgba(15,15,15,0.08)]"
                  >
                    <PageIcon icon={page.icon} kind={page.kind} size={32} />
                    <span>
                      <span className="block truncate text-[14px] font-medium">
                        {pageLabel(page)}
                      </span>
                      <span className="text-subtle block text-[12px]">
                        {formatRelative(page.last_edited_at, now)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}
