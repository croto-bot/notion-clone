import type { JSX } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react'
import {
  Code,
  Database,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Lightbulb,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  Minus,
  Table2,
  TextQuote,
  Type,
} from 'lucide-react'
import { usePageActions } from '@/hooks/usePageActions'
import { requestTitleFocus } from '@/lib/title-focus'
import type { BlockNoteEditor } from '@blocknote/core'

// The editor type depends on the schema's block list: the slash menu only needs its common methods.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Editor = BlockNoteEditor<any, any, any>

interface SlashItemSpec {
  /** Key of BlockNote's own item (its onItemClick is reused), or a custom id. */
  key: string
  title: string
  subtext: string
  aliases: string[]
  group: string
  icon: JSX.Element
  /** The Markdown shortcut shown on the right, like Notion's. */
  hint?: string
}

const BASIC = 'Basic blocks'

/** The slash menu in Notion's order, with Notion's wording. */
const SPECS: SlashItemSpec[] = [
  {
    key: 'paragraph',
    title: 'Text',
    subtext: 'Just start writing with plain text.',
    aliases: ['text', 'paragraph', 'p', 'plain'],
    group: BASIC,
    icon: <Type size={18} />,
  },
  {
    key: 'page',
    title: 'Page',
    subtext: 'Embed a sub-page inside this page.',
    aliases: ['page', 'subpage', 'sub-page', 'new page', 'link to page'],
    group: BASIC,
    icon: <FileText size={18} />,
  },
  {
    key: 'check_list',
    hint: '[]',
    title: 'To-do list',
    subtext: 'Track tasks with a to-do list.',
    aliases: ['todo', 'to-do', 'task', 'checkbox', 'check', 'list'],
    group: BASIC,
    icon: <ListChecks size={18} />,
  },
  {
    key: 'heading',
    hint: '#',
    title: 'Heading 1',
    subtext: 'Big section heading.',
    aliases: ['h1', 'heading', 'heading1', 'title', 'big'],
    group: BASIC,
    icon: <Heading1 size={18} />,
  },
  {
    key: 'heading_2',
    hint: '##',
    title: 'Heading 2',
    subtext: 'Medium section heading.',
    aliases: ['h2', 'heading2', 'subtitle', 'medium'],
    group: BASIC,
    icon: <Heading2 size={18} />,
  },
  {
    key: 'heading_3',
    hint: '###',
    title: 'Heading 3',
    subtext: 'Small section heading.',
    aliases: ['h3', 'heading3', 'small'],
    group: BASIC,
    icon: <Heading3 size={18} />,
  },
  {
    key: 'table',
    title: 'Table',
    subtext: 'Add simple tabular content to your page.',
    aliases: ['table', 'grid'],
    group: BASIC,
    icon: <Table2 size={18} />,
  },
  {
    key: 'bullet_list',
    hint: '-',
    title: 'Bulleted list',
    subtext: 'Create a simple bulleted list.',
    aliases: ['bullet', 'bulleted', 'ul', 'list', 'unordered'],
    group: BASIC,
    icon: <List size={18} />,
  },
  {
    key: 'numbered_list',
    hint: '1.',
    title: 'Numbered list',
    subtext: 'Create a list with numbering.',
    aliases: ['number', 'numbered', 'ol', 'list', 'ordered'],
    group: BASIC,
    icon: <ListOrdered size={18} />,
  },
  {
    key: 'toggle_list',
    hint: '>',
    title: 'Toggle list',
    subtext: 'Toggles can hide and show content inside.',
    aliases: ['toggle', 'collapse', 'details', 'list'],
    group: BASIC,
    icon: <ListCollapse size={18} />,
  },
  {
    key: 'quote',
    hint: '"',
    title: 'Quote',
    subtext: 'Capture a quote.',
    aliases: ['quote', 'blockquote', 'citation'],
    group: BASIC,
    icon: <TextQuote size={18} />,
  },
  {
    key: 'divider',
    hint: '---',
    title: 'Divider',
    subtext: 'Visually divide blocks.',
    aliases: ['divider', 'hr', 'line', 'separator', 'rule'],
    group: BASIC,
    icon: <Minus size={18} />,
  },
  {
    key: 'callout',
    title: 'Callout',
    subtext: 'Make writing stand out.',
    aliases: ['callout', 'note', 'info', 'tip', 'highlight'],
    group: BASIC,
    icon: <Lightbulb size={18} />,
  },
  {
    key: 'code_block',
    hint: '```',
    title: 'Code',
    subtext: 'Capture a code snippet.',
    aliases: ['code', 'snippet', 'pre', 'codeblock'],
    group: BASIC,
    icon: <Code size={18} />,
  },
  {
    key: 'image',
    title: 'Image',
    subtext: 'Embed an image from a link.',
    aliases: ['image', 'img', 'picture', 'photo', 'embed'],
    group: 'Media',
    icon: <ImageIcon size={18} />,
  },
  {
    key: 'database',
    title: 'Database',
    subtext: 'Create a table, board, list or gallery.',
    aliases: ['database', 'db', 'table view', 'board', 'kanban', 'gallery'],
    group: 'Advanced blocks',
    icon: <Database size={18} />,
  },
]

/**
 * The items of the `/` menu for one editor. "Page" and "Database" create a child
 * of the open page, insert a link block to it and open it, like Notion.
 */
export function useSlashMenuItems(editor: Editor, pageId: string) {
  const { createPage } = usePageActions()
  const navigate = useNavigate()

  const insertChild = async (kind: 'page' | 'database') => {
    const child = await createPage({ parentId: pageId, kind, stay: true })
    if (!child) return
    insertOrUpdateBlockForSlashMenu(editor, { type: 'pageLink', props: { pageId: child.id } })
    requestTitleFocus(child.id)
    // The new block reaches the server first; then the new page opens.
    setTimeout(() => void navigate({ to: '/p/$pageId', params: { pageId: child.id } }), 250)
  }

  return (): DefaultReactSuggestionItem[] => {
    const defaults = new Map(
      getDefaultReactSlashMenuItems(editor).map(item => [(item as { key?: string }).key, item])
    )
    const items: DefaultReactSuggestionItem[] = []
    for (const spec of SPECS) {
      const base = {
        title: spec.title,
        subtext: spec.subtext,
        aliases: spec.aliases,
        group: spec.group,
        icon: spec.icon,
        badge: spec.hint,
      }
      if (spec.key === 'page' || spec.key === 'database') {
        items.push({
          ...base,
          onItemClick: () => void insertChild(spec.key as 'page' | 'database'),
        })
      } else if (spec.key === 'callout') {
        items.push({
          ...base,
          onItemClick: () => {
            insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' })
          },
        })
      } else {
        const original = defaults.get(spec.key)
        if (original) items.push({ ...base, onItemClick: original.onItemClick })
      }
    }
    return items
  }
}
