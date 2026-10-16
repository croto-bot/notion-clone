import { useEffect, useMemo, useState } from 'react'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { withCollaboration } from '@blocknote/core/yjs'
import { BlockNoteView } from '@blocknote/mantine'
import { SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import '@blocknote/mantine/style.css'
import '@/styles/editor.css'
import { editorSchema } from '@/components/EditorBlocks'
import { useSlashMenuItems } from '@/components/EditorSlashMenu'
import { usePageEditorApi } from '@/contexts/PageEditorContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { DOCUMENT_FRAGMENT, type CollabSession } from '@/hooks/useCollabSession'
import { usePageTree } from '@/hooks/usePages'
import { PageLinkContext, type PageLinkResolver } from '@/features/editor/page-link-context'
import { editorDictionary } from '@/features/editor/options'
import { notionTheme } from '@/features/editor/theme'
import { cn } from '@/lib/utils'
import type { PageResponse } from '@/types/page'

/** How long to wait for the first sync before showing the editor anyway (offline start). */
const SYNC_WAIT_MS = 3000

interface CollabEditorProps {
  page: PageResponse
  session: CollabSession
  editable: boolean
}

function CollabEditor({ page, session, editable }: CollabEditorProps) {
  const { resolvedTheme } = useTheme()
  const { setApi } = usePageEditorApi()
  const { workspace } = useWorkspace()
  const { data: tree = [] } = usePageTree(workspace.id)

  const editor = useCreateBlockNote(
    withCollaboration({
      schema: editorSchema,
      dictionary: editorDictionary,
      collaboration: {
        provider: session.provider,
        fragment: session.doc.getXmlFragment(DOCUMENT_FRAGMENT),
        user: session.user,
        showCursorLabels: 'activity',
      },
    }),
    [session.doc, session.provider]
  )

  // Hand the page menu (export, import) a way to reach this editor.
  useEffect(() => {
    setApi({
      exportMarkdown: () => editor.blocksToMarkdownLossy(editor.document),
      importMarkdown: async markdown => {
        const blocks = await editor.tryParseMarkdownToBlocks(markdown)
        editor.replaceBlocks(editor.document, blocks)
      },
      focusStart: () => {
        const first = editor.document[0]
        if (first) editor.setTextCursorPosition(first, 'start')
        editor.focus()
      },
    })
    return () => setApi(null)
  }, [editor, setApi])

  const resolvePage = useMemo<PageLinkResolver>(() => {
    const byId = new Map(tree.map(item => [item.id, item]))
    return id => {
      const found = byId.get(id)
      if (!found) return undefined
      return {
        title: found.title,
        icon: found.icon,
        kind: found.kind,
        href: { to: '/p/$pageId', params: { pageId: found.id } },
      }
    }
  }, [tree])

  const getSlashItems = useSlashMenuItems(editor, page.id)

  return (
    <PageLinkContext.Provider value={resolvePage}>
      <BlockNoteView
        editor={editor}
        theme={resolvedTheme === 'dark' ? notionTheme.dark : notionTheme.light}
        editable={editable}
        slashMenu={false}
        className={cn('nx-editor', page.small_text && 'nx-small-text')}
        data-testid="editor"
        data-editable={editable}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async query => filterSuggestionItems(getSlashItems(), query)}
        />
      </BlockNoteView>
      {/* The empty space below the last block puts the cursor at the end, like Notion. */}
      {editable && (
        <div
          aria-hidden="true"
          className="h-[30vh] cursor-text"
          onClick={() => {
            const last = editor.document[editor.document.length - 1]
            if (last) editor.setTextCursorPosition(last, 'end')
            editor.focus()
          }}
        />
      )}
    </PageLinkContext.Provider>
  )
}

function EditorSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse space-y-3 pt-2">
      <div className="bg-hover h-4 w-full rounded-[3px]" />
      <div className="bg-hover h-4 w-4/5 rounded-[3px]" />
      <div className="bg-hover h-4 w-3/5 rounded-[3px]" />
    </div>
  )
}

interface DocumentEditorProps {
  page: PageResponse
  /** The collaboration session, or null while it connects. */
  session: CollabSession | null
  editable: boolean
}

/**
 * The page body: a BlockNote editor bound to the page's Yjs document. It shows
 * once the first sync with the server is done (or after a short wait when the
 * socket is down), so the stored content and the editor never race.
 */
export function DocumentEditor({ page, session, editable }: DocumentEditorProps) {
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), SYNC_WAIT_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!session || !(session.synced || waited)) return <EditorSkeleton />
  return <CollabEditor page={page} session={session} editable={editable} />
}
