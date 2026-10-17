import { useState } from 'react'
import { PurgeConfirmDialog } from '@/components/PurgeConfirmDialog'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import type { PageResponse } from '@/types/page'

/** The red banner of a trashed page: it opens read-only, with Restore and Delete forever. */
export function TrashBanner({ page }: { page: PageResponse }) {
  const { restorePage } = usePageActions()
  const { canEdit } = useWorkspace()
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      role="alert"
      data-testid="trash-banner"
      className="bg-banner flex min-h-[44px] shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-1.5 text-[14px] font-medium text-white"
    >
      <span>This page is in Trash.</span>
      {canEdit && (
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void restorePage(page)}
            className="h-7 rounded-[4px] bg-white/0 px-2.5 text-[14px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] transition-colors duration-100 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            Restore page
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="h-7 rounded-[4px] bg-white/0 px-2.5 text-[14px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] transition-colors duration-100 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            Delete permanently
          </button>
        </span>
      )}
      <PurgeConfirmDialog page={confirming ? page : null} onClose={() => setConfirming(false)} />
    </div>
  )
}
