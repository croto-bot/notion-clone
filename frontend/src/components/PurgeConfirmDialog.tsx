import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { usePageActions } from '@/hooks/usePageActions'
import { pageLabel } from '@/features/pages/page-tree'
import type { PageSummary } from '@/types/page'

interface PurgeConfirmDialogProps {
  /** The trashed page to delete forever; null closes the dialog. */
  page: PageSummary | null
  onClose: () => void
}

/** "Delete permanently?": the last step before a trashed page is gone for good. */
export function PurgeConfirmDialog({ page, onClose }: PurgeConfirmDialogProps) {
  const { purgePage } = usePageActions()
  return (
    <AlertDialog open={page !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this page permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            {page ? `"${pageLabel(page)}" and everything inside it will be deleted forever. ` : ''}
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (page) void purgePage(page)
              onClose()
            }}
          >
            Delete permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
