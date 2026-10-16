import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BlockNoteSchema, defaultBlockSpecs, defaultProps } from '@blocknote/core'
import { createReactBlockSpec } from '@blocknote/react'
import { EmojiPicker } from '@/components/EmojiPicker'
import { PageIcon } from '@/components/PageIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePageLink } from '@/features/editor/page-link-context'
import { UNTITLED } from '@/features/pages/page-tree'

/** A block with an icon and a soft background, like Notion's callout. */
export const createCalloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {
      backgroundColor: defaultProps.backgroundColor,
      textColor: defaultProps.textColor,
      icon: { default: '💡' },
    },
    content: 'inline',
  },
  {
    render: ({ block, editor, contentRef }) => (
      <CalloutBlock block={block} editor={editor} contentRef={contentRef} />
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <blockquote>
        <span>{block.props.icon} </span>
        <span ref={contentRef} />
      </blockquote>
    ),
  }
)

function CalloutBlock({
  block,
  editor,
  contentRef,
}: {
  block: { id: string; props: { icon: string } }
  editor: {
    isEditable: boolean
    updateBlock: (block: string, update: { props: { icon: string } }) => void
  }
  contentRef: (node: HTMLElement | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="nx-callout" data-testid="callout">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={!editor.isEditable}>
          <button
            type="button"
            contentEditable={false}
            aria-label="Change callout icon"
            disabled={!editor.isEditable}
            className="nx-callout-icon"
          >
            {block.props.icon}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <EmojiPicker
            onSelect={emoji => {
              setOpen(false)
              editor.updateBlock(block.id, { props: { icon: emoji } })
            }}
          />
        </PopoverContent>
      </Popover>
      <div className="nx-callout-content" ref={contentRef} />
    </div>
  )
}

/** A line with a page's icon and title that opens the page: the result of the "Page" slash item. */
export const createPageLinkBlock = createReactBlockSpec(
  {
    type: 'pageLink',
    propSchema: {
      pageId: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => <PageLinkBlock pageId={block.props.pageId} />,
    toExternalHTML: ({ block }) => <p>{`[page:${block.props.pageId}]`}</p>,
  }
)

function PageLinkBlock({ pageId }: { pageId: string }) {
  const info = usePageLink(pageId)
  const title = info?.title.trim() ? info.title : UNTITLED
  const content = (
    <>
      <PageIcon icon={info?.icon} kind={info?.kind} size={22} />
      <span className="nx-page-link-title">{title}</span>
    </>
  )
  if (info?.href?.to === '/p/$pageId') {
    return (
      <Link
        to="/p/$pageId"
        params={info.href.params}
        className="nx-page-link"
        data-testid="page-link"
        contentEditable={false}
        draggable={false}
      >
        {content}
      </Link>
    )
  }
  if (info?.href?.to === '/share/$publicId') {
    return (
      <Link
        to="/share/$publicId"
        params={info.href.params}
        className="nx-page-link"
        data-testid="page-link"
        contentEditable={false}
        draggable={false}
      >
        {content}
      </Link>
    )
  }
  return (
    <span
      className="nx-page-link nx-page-link-static"
      data-testid="page-link"
      contentEditable={false}
    >
      {content}
    </span>
  )
}

/** The editor's block types: BlockNote's defaults plus the callout and the page link. */
export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: createCalloutBlock(),
    pageLink: createPageLinkBlock(),
  },
})

export type EditorSchema = typeof editorSchema
