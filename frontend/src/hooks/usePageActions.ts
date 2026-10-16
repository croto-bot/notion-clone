import { useCallback } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import {
  useCreatePage,
  useDeletePage,
  useDuplicatePage,
  useMovePage,
  usePurgePage,
  useRestorePage,
  useSetFavorite,
  useUpdatePage,
} from '@/hooks/usePages'
import { copyText } from '@/lib/clipboard'
import { toastApiError } from '@/lib/error-handler'
import { requestTitleFocus } from '@/lib/title-focus'
import { pageLabel } from '@/features/pages/page-tree'
import { queryKeys } from '@/lib/query-keys'
import type { PageKind, PageResponse, PageSummary, UpdatePageData } from '@/types/page'

interface CreateOptions {
  parentId?: string | null
  kind?: PageKind
  title?: string
  afterId?: string | null
  /** Stay on the current page (used by the editor's Page slash item). */
  stay?: boolean
}

/** Actions on pages with their toasts and navigation. Used by the sidebar, the top bar and menus. */
export function usePageActions() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const currentPageId = useParams({ strict: false }).pageId as string | undefined

  const createMutation = useCreatePage()
  const updateMutation = useUpdatePage()
  const moveMutation = useMovePage()
  const duplicateMutation = useDuplicatePage()
  const deleteMutation = useDeletePage()
  const restoreMutation = useRestorePage()
  const purgeMutation = usePurgePage()
  const favoriteMutation = useSetFavorite()

  const openPage = useCallback(
    (pageId: string) => navigate({ to: '/p/$pageId', params: { pageId } }),
    [navigate]
  )

  const createPage = useCallback(
    async (options: CreateOptions = {}): Promise<PageResponse | null> => {
      try {
        const page = await createMutation.mutateAsync({
          workspace_id: workspace.id,
          parent_id: options.parentId ?? null,
          kind: options.kind ?? 'page',
          title: options.title ?? '',
          ...(options.afterId !== undefined ? { after_id: options.afterId } : {}),
        })
        if (!options.stay) {
          requestTitleFocus(page.id)
          await openPage(page.id)
        }
        return page
      } catch (error) {
        toastApiError(error, 'Could not create the page')
        return null
      }
    },
    [createMutation, workspace.id, openPage]
  )

  const updatePage = useCallback(
    async (id: string, data: UpdatePageData): Promise<PageResponse | null> => {
      try {
        return await updateMutation.mutateAsync({ id, data })
      } catch (error) {
        toastApiError(error, 'Could not save the page')
        return null
      }
    },
    [updateMutation]
  )

  const duplicatePage = useCallback(
    async (page: PageSummary) => {
      try {
        const copy = await duplicateMutation.mutateAsync(page.id)
        toast.success(`Duplicated "${pageLabel(page)}"`)
        await openPage(copy.id)
      } catch (error) {
        toastApiError(error, 'Could not duplicate the page')
      }
    },
    [duplicateMutation, openPage]
  )

  const restorePage = useCallback(
    async (page: PageSummary) => {
      try {
        await restoreMutation.mutateAsync(page.id)
        toast.success(`Restored "${pageLabel(page)}"`)
      } catch (error) {
        toastApiError(error, 'Could not restore the page')
      }
    },
    [restoreMutation]
  )

  const deletePage = useCallback(
    async (page: PageSummary) => {
      try {
        await deleteMutation.mutateAsync(page.id)
      } catch (error) {
        toastApiError(error, 'Could not delete the page')
        return
      }
      toast(`"${pageLabel(page)}" moved to Trash`, {
        action: { label: 'Undo', onClick: () => void restorePage(page) },
      })
      // Leave the page that is gone (or the parent of a gone subtree).
      const open = currentPageId
        ? queryClient.getQueryData<PageResponse>(queryKeys.pages.detail(currentPageId))
        : undefined
      const insideDeleted =
        currentPageId === page.id || open?.breadcrumbs.some(crumb => crumb.id === page.id)
      if (insideDeleted) await navigate({ to: '/home' })
    },
    [deleteMutation, restorePage, currentPageId, queryClient, navigate]
  )

  const purgePage = useCallback(
    async (page: PageSummary) => {
      try {
        await purgeMutation.mutateAsync(page.id)
        toast.success(`Deleted "${pageLabel(page)}" forever`)
        if (currentPageId === page.id) await navigate({ to: '/home' })
      } catch (error) {
        toastApiError(error, 'Could not delete the page')
      }
    },
    [purgeMutation, currentPageId, navigate]
  )

  const movePage = useCallback(
    async (id: string, parentId: string | null, afterId?: string | null) => {
      try {
        await moveMutation.mutateAsync({
          id,
          parent_id: parentId,
          ...(afterId !== undefined ? { after_id: afterId } : {}),
        })
        return true
      } catch (error) {
        toastApiError(error, 'Could not move the page')
        return false
      }
    },
    [moveMutation]
  )

  const toggleFavorite = useCallback(
    async (page: PageSummary, favorite: boolean) => {
      try {
        await favoriteMutation.mutateAsync({ page, favorite })
        toast.success(favorite ? 'Added to Favorites' : 'Removed from Favorites')
      } catch (error) {
        toastApiError(error, 'Could not update Favorites')
      }
    },
    [favoriteMutation]
  )

  const copyLink = useCallback(async (pageId: string) => {
    const ok = await copyText(`${window.location.origin}/p/${pageId}`)
    if (ok) toast.success('Link copied')
    else toast.error('Could not copy the link')
  }, [])

  return {
    openPage,
    createPage,
    updatePage,
    duplicatePage,
    restorePage,
    deletePage,
    purgePage,
    movePage,
    toggleFavorite,
    copyLink,
  }
}
