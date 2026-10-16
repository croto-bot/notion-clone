import { Lock, MessageSquare, Star, WifiOff } from 'lucide-react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { PageOptionsMenu } from '@/components/PageOptionsMenu'
import { PresenceAvatars } from '@/components/PresenceAvatars'
import { SharePopover } from '@/components/SharePopover'
import { Topbar, TopbarButton } from '@/components/Topbar'
import { Tip } from '@/components/ui/tooltip'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import { useNow } from '@/hooks/useNow'
import type { CollabStatus, PresenceUser } from '@/hooks/useCollabSession'
import { displayNameOf } from '@/hooks/useUser'
import { formatEdited } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { PageResponse } from '@/types/page'

interface PageTopbarProps {
  page: PageResponse
  users: PresenceUser[]
  status: CollabStatus
  commentsOpen: boolean
  onToggleComments: () => void
}

/** Breadcrumbs on the left; edited time, avatars, Share, comments, star and "..." on the right. */
export function PageTopbar({
  page,
  users,
  status,
  commentsOpen,
  onToggleComments,
}: PageTopbarProps) {
  const { canEdit } = useWorkspace()
  const { updatePage, toggleFavorite } = usePageActions()
  const now = useNow()
  const trashed = page.deleted_at !== null
  const editedBy = page.last_edited_by ? ` by ${displayNameOf(page.last_edited_by)}` : ''

  return (
    <Topbar
      actions={
        <>
          {status === 'disconnected' && !trashed && (
            <Tip label="Offline: your changes are kept and sync when you reconnect">
              <span
                role="status"
                aria-label="Offline"
                className="text-muted-foreground mr-1 inline-flex items-center gap-1 px-1.5 text-[13px]"
              >
                <WifiOff className="size-4" />
                <span className="hidden lg:inline">Offline</span>
              </span>
            </Tip>
          )}
          <Tip label={`${formatEdited(page.last_edited_at, now)}${editedBy}`.trim()} side="bottom">
            <span
              data-testid="edited-label"
              className="text-muted-foreground mr-1 hidden px-1.5 text-[13px] md:inline"
            >
              {formatEdited(page.last_edited_at, now)}
            </span>
          </Tip>
          <PresenceAvatars users={users} />
          {!trashed && (
            <>
              {page.locked && (
                <Tip label={canEdit ? 'Locked. Click to unlock' : 'This page is locked'}>
                  <TopbarButton
                    aria-label={canEdit ? 'Unlock page' : 'Page is locked'}
                    disabled={!canEdit}
                    onClick={() => void updatePage(page.id, { locked: false })}
                  >
                    <Lock />
                  </TopbarButton>
                </Tip>
              )}
              <SharePopover page={page} />
              <Tip label="Comments">
                <TopbarButton
                  aria-label="Comments"
                  active={commentsOpen}
                  aria-pressed={commentsOpen}
                  onClick={onToggleComments}
                >
                  <MessageSquare />
                </TopbarButton>
              </Tip>
              <Tip label={page.is_favorite ? 'Remove from Favorites' : 'Add to Favorites'}>
                <TopbarButton
                  aria-label={page.is_favorite ? 'Remove from Favorites' : 'Add to Favorites'}
                  aria-pressed={page.is_favorite}
                  onClick={() => void toggleFavorite(page, !page.is_favorite)}
                >
                  <Star className={cn(page.is_favorite && 'fill-[#dfab01] text-[#dfab01]')} />
                </TopbarButton>
              </Tip>
            </>
          )}
          <PageOptionsMenu page={page} />
        </>
      }
    >
      <Breadcrumbs page={page} />
    </Topbar>
  )
}
