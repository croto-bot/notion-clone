import { BlockNoteEditor } from '@blocknote/core'
import { blocksToYDoc } from '@blocknote/core/yjs'
import * as Y from 'yjs'
import { editorSchema } from '@/components/EditorBlocks'
import { bytesToBase64 } from '@/features/editor/options'
import { DOCUMENT_FRAGMENT } from '@/hooks/useCollabSession'

export async function markdownToYjsState(markdown: string): Promise<string> {
  const editor = BlockNoteEditor.create({ schema: editorSchema })
  const blocks = await editor.tryParseMarkdownToBlocks(markdown)
  const doc = blocksToYDoc(editor, blocks, DOCUMENT_FRAGMENT)
  return bytesToBase64(Y.encodeStateAsUpdate(doc))
}
