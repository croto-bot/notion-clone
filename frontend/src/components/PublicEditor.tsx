import { useMemo } from 'react'
import * as Y from 'yjs'
import { withCollaboration } from '@blocknote/core/yjs'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/mantine/style.css'
import '@/styles/editor.css'
import { editorSchema } from '@/components/EditorBlocks'
import { useTheme } from '@/contexts/ThemeContext'
import { DOCUMENT_FRAGMENT } from '@/hooks/useCollabSession'
import { editorDictionary, base64ToBytes } from '@/features/editor/options'
import { PageLinkContext, type PageLinkResolver } from '@/features/editor/page-link-context'
import { notionTheme } from '@/features/editor/theme'
import { cn } from '@/lib/utils'

interface PublicEditorProps {
  /** Base64 Yjs update of the published page. */
  state: string | null
  resolvePage: PageLinkResolver
  smallText: boolean
}

/**
 * Read-only BlockNote view of a published page: the stored Yjs update goes into
 * a local document and renders through the editor. No socket, no sign-in.
 */
export function PublicEditor({ state, resolvePage, smallText }: PublicEditorProps) {
  const { resolvedTheme } = useTheme()
  const doc = useMemo(() => {
    const ydoc = new Y.Doc()
    if (state) Y.applyUpdate(ydoc, base64ToBytes(state))
    return ydoc
  }, [state])

  const editor = useCreateBlockNote(
    withCollaboration({
      schema: editorSchema,
      dictionary: editorDictionary,
      collaboration: {
        fragment: doc.getXmlFragment(DOCUMENT_FRAGMENT),
        user: { name: 'Reader', color: '#9b9a97' },
      },
    }),
    [doc]
  )

  return (
    <PageLinkContext.Provider value={resolvePage}>
      <BlockNoteView
        editor={editor}
        theme={resolvedTheme === 'dark' ? notionTheme.dark : notionTheme.light}
        editable={false}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        className={cn('nx-editor', smallText && 'nx-small-text')}
        data-testid="public-editor"
      />
    </PageLinkContext.Provider>
  )
}
