import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, MessageSquarePlus, SmilePlus } from 'lucide-react'
import { CoverPicker } from '@/components/CoverPicker'
import { Discussions } from '@/components/Discussions'
import { EmojiPicker } from '@/components/EmojiPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePageEditorApi } from '@/contexts/PageEditorContext'
import { usePageActions } from '@/hooks/usePageActions'
import { patchPageEverywhere } from '@/features/pages/page-cache'
import { randomEmoji } from '@/features/emoji/emoji-data'
import { COVER_PRESETS, coverBackground, isRenderableCover } from '@/lib/colors'
import { consumeTitleFocus } from '@/lib/title-focus'
import { cn } from '@/lib/utils'
import type { PageKind, PageResponse } from '@/types/page'

/** Docs stay in a 708 px column. Full width and databases keep the 96 px margin only. */
export function pageColumnClass(page: { full_width: boolean; kind: PageKind }) {
  const wide = page.full_width || page.kind === 'database'
  return cn('mx-auto w-full px-6 md:px-24', wide ? 'max-w-none' : 'max-w-[900px]')
}

const SAVE_DELAY_MS = 500

function Cover({ page, editable }: { page: PageResponse; editable: boolean }) {
  const { updatePage } = usePageActions()
  const [pickerOpen, setPickerOpen] = useState(false)
  // While repositioning, the dragged position; otherwise null and the saved one shows.
  const [dragPosition, setDragPosition] = useState<number | null>(null)
  const repositioning = dragPosition !== null
  const position = dragPosition ?? page.cover_position
  const box = useRef<HTMLDivElement>(null)
  const isImage =
    isRenderableCover(page.cover) && !COVER_PRESETS.some(item => item.key === page.cover)

  // No renderable cover (none, or a value from before the rule): no band.
  if (!page.cover || !isRenderableCover(page.cover)) return null

  const startDrag = (event: React.PointerEvent) => {
    if (!repositioning || !box.current) return
    event.preventDefault()
    const startY = event.clientY
    const startPosition = position
    const height = box.current.clientHeight
    const onMove = (move: PointerEvent) => {
      // Dragging down shows more of the top of the image.
      const next = startPosition - ((move.clientY - startY) / height) * 100
      setDragPosition(Math.max(0, Math.min(100, Math.round(next))))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const buttonClass =
    'bg-background/90 text-muted-foreground hover:bg-background h-6 rounded-[4px] px-2 text-[12px] font-medium shadow-[0_0_0_1px_var(--border)] backdrop-blur transition-colors duration-100'

  return (
    <div
      ref={box}
      data-testid="page-cover"
      className={cn(
        'group/cover relative h-[30vh] max-h-[280px] min-h-[160px] w-full shrink-0',
        repositioning && 'cursor-grab active:cursor-grabbing'
      )}
      style={coverBackground(page.cover, position)}
      onPointerDown={startDrag}
    >
      {repositioning && (
        <div className="absolute inset-x-0 top-3 flex justify-center">
          <span className="bg-background/90 rounded-[4px] px-2 py-1 text-[12px] font-medium shadow-[0_0_0_1px_var(--border)]">
            Drag image to reposition
          </span>
        </div>
      )}
      {editable && (
        <div
          className={cn(
            'absolute right-0 bottom-3 left-0 flex justify-center transition-opacity duration-150',
            repositioning || pickerOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/cover:opacity-100 focus-within:opacity-100'
          )}
        >
          <div className={cn(pageColumnClass(page), 'flex justify-end gap-1.5')}>
            {repositioning ? (
              <>
                <button type="button" className={buttonClass} onClick={() => setDragPosition(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    setDragPosition(null)
                    void updatePage(page.id, { cover_position: position })
                  }}
                >
                  Save position
                </button>
              </>
            ) : (
              <>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" className={buttonClass}>
                      Change cover
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-auto p-0">
                    <CoverPicker
                      current={page.cover}
                      onSelect={cover => {
                        setPickerOpen(false)
                        void updatePage(page.id, { cover, cover_position: 50 })
                      }}
                      onRemove={() => {
                        setPickerOpen(false)
                        void updatePage(page.id, { cover: null })
                      }}
                    />
                  </PopoverContent>
                </Popover>
                {isImage && (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => setDragPosition(page.cover_position)}
                  >
                    Reposition
                  </button>
                )}
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => void updatePage(page.id, { cover: null })}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PageTitle({
  page,
  editable,
  onEnter,
}: {
  page: PageResponse
  editable: boolean
  onEnter: () => void
}) {
  const queryClient = useQueryClient()
  const { updatePage } = usePageActions()
  // What I am typing, or null when the title shows what the server has (another member can rename it).
  const [draft, setDraft] = useState<string | null>(null)
  const title = draft ?? page.title
  const ref = useRef<HTMLTextAreaElement>(null)
  // The text not yet sent to the server, or null.
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pageId = page.id

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const value = pending.current
    if (value === null) return
    pending.current = null
    void updatePage(pageId, { title: value }).then(saved => {
      // A refused title stays in the draft, so the header would keep showing
      // it after the cache rolls back. A newer draft must not be cleared.
      if (saved !== null) return
      setDraft(current => (current === value ? null : current))
    })
  }, [pageId, updatePage])

  // Always hold the latest flush; only leaving the page flushes here (the
  // debounce and the blur handler cover everything while the page is open).
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  useEffect(() => () => flushRef.current(), [])

  // A page just created from the sidebar opens with the cursor in the title.
  useEffect(() => {
    if (editable && consumeTitleFocus(pageId)) ref.current?.focus()
  }, [editable, pageId])

  // Auto-height: the title grows with its text.
  useEffect(() => {
    const area = ref.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }, [title])

  const onChange = (value: string) => {
    const clean = value.replace(/\n/g, ' ')
    setDraft(clean)
    pending.current = clean
    // The sidebar and breadcrumbs follow at once; the request waits for a pause in typing.
    patchPageEverywhere(queryClient, pageId, { title: clean })
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label="Page title"
      data-testid="page-title"
      placeholder="Untitled"
      readOnly={!editable}
      value={title}
      onChange={event => onChange(event.target.value)}
      onBlur={() => {
        flush()
        setDraft(null)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          flush()
          onEnter()
        }
      }}
      className="placeholder:text-subtle block w-full resize-none overflow-hidden bg-transparent px-[2px] text-[40px] leading-[1.2] font-bold tracking-[-0.01em] break-words outline-none"
    />
  )
}

interface PageHeaderProps {
  page: PageResponse
  /** False for viewers, locked pages and the trash. */
  editable: boolean
}

/** Cover, icon, hover buttons, title and the discussions of a page. */
export function PageHeader({ page, editable }: PageHeaderProps) {
  const { updatePage } = usePageActions()
  const { api: editor } = usePageEditorApi()
  const [iconOpen, setIconOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const canCover = editable
  // The band renders only a renderable cover; the icon strip's overlap must
  // follow the same predicate, or a non-renderable value (from before the
  // rule) would push the icon up over nothing.
  const hasCover = isRenderableCover(page.cover)

  const addIcon = async () => {
    const emoji = await randomEmoji()
    await updatePage(page.id, { icon: emoji })
    setIconOpen(true)
  }

  const setIcon = (emoji: string | null) => {
    setIconOpen(false)
    void updatePage(page.id, { icon: emoji })
  }

  const hoverButton =
    'text-muted-foreground hover:bg-hover flex h-7 items-center gap-1.5 rounded-[4px] px-1.5 text-[13px] transition-colors duration-100 [&_svg]:size-4'

  return (
    <div className="group/header">
      <Cover page={page} editable={canCover} />
      <div className={pageColumnClass(page)}>
        {page.icon ? (
          <div
            className={cn(
              // pointer-events-none: the strip overlaps the cover's hover controls
              // (z-10, -mt-[39px]); only the icon button itself takes pointer events.
              'pointer-events-none relative z-10 h-[78px]',
              hasCover ? '-mt-[39px]' : 'pt-[0px] mt-[56px]'
            )}
          >
            <Popover open={iconOpen} onOpenChange={setIconOpen}>
              <PopoverTrigger asChild disabled={!editable}>
                <button
                  type="button"
                  aria-label="Change page icon"
                  disabled={!editable}
                  data-testid="page-icon"
                  className="hover:bg-hover pointer-events-auto flex size-[78px] items-center justify-center rounded-[6px] text-[66px] leading-none transition-colors duration-100 disabled:hover:bg-transparent"
                >
                  {page.icon}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <EmojiPicker onSelect={setIcon} onRemove={() => setIcon(null)} />
              </PopoverContent>
            </Popover>
          </div>
        ) : (
          <div className={hasCover ? 'h-[24px]' : 'h-[72px]'} />
        )}

        <div
          className={cn(
            'flex h-[32px] items-center gap-0.5 transition-opacity duration-150',
            iconOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/header:opacity-100 focus-within:opacity-100'
          )}
        >
          {editable && !page.icon && (
            <button type="button" className={hoverButton} onClick={() => void addIcon()}>
              <SmilePlus />
              Add icon
            </button>
          )}
          {canCover && !hasCover && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={hoverButton}>
                  <ImagePlus />
                  Add cover
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <CoverPicker
                  current={null}
                  onSelect={cover => void updatePage(page.id, { cover, cover_position: 50 })}
                  onRemove={() => undefined}
                />
              </PopoverContent>
            </Popover>
          )}
          {!page.deleted_at && (
            <button type="button" className={hoverButton} onClick={() => setComposing(true)}>
              <MessageSquarePlus />
              Add comment
            </button>
          )}
        </div>

        <PageTitle page={page} editable={editable} onEnter={() => editor?.focusStart()} />
        <div className="h-3" />
        <Discussions
          pageId={page.id}
          composing={composing}
          onDoneComposing={() => setComposing(false)}
        />
      </div>
    </div>
  )
}
