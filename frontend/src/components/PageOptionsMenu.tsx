import { useRef } from 'react'
import {
  Copy,
  CornerUpRight,
  Download,
  Link2,
  MoreHorizontal,
  Star,
  StarOff,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { TopbarButton } from '@/components/Topbar'
import { useAppShell } from '@/contexts/AppShellContext'
import { usePageEditorApi } from '@/contexts/PageEditorContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import { displayNameOf } from '@/hooks/useUser'
import { pageLabel } from '@/features/pages/page-tree'
import { formatDateTime } from '@/lib/time'
import { toastApiError } from '@/lib/error-handler'
import { cn } from '@/lib/utils'
import type { PageFont, PageResponse } from '@/types/page'

const FONTS: { value: PageFont; label: string; sample: string; className: string }[] = [
  { value: 'default', label: 'Default', sample: 'Ag', className: 'font-sans' },
  { value: 'serif', label: 'Serif', sample: 'Ag', className: 'font-serif' },
  { value: 'mono', label: 'Mono', sample: 'Ag', className: 'font-mono' },
]

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function safeFilename(title: string): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled'}.md`
}

function ToggleRow({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      onSelect={event => {
        // Notion keeps the menu open while you flip switches.
        event.preventDefault()
        onToggle()
      }}
    >
      <span className="flex-1">{label}</span>
      <Switch checked={checked} tabIndex={-1} aria-hidden="true" className="pointer-events-none" />
    </DropdownMenuItem>
  )
}

/** The "..." menu of the top bar: font, small text, full width, lock, favorites, export and more. */
export function PageOptionsMenu({ page }: { page: PageResponse }) {
  const { canEdit } = useWorkspace()
  const { openMoveTo } = useAppShell()
  const { api: editor } = usePageEditorApi()
  const { updatePage, duplicatePage, deletePage, toggleFavorite, copyLink } = usePageActions()
  const fileInput = useRef<HTMLInputElement>(null)
  const isDocument = page.kind === 'page'

  const exportMarkdown = () => {
    if (!editor) return
    downloadText(safeFilename(page.title), editor.exportMarkdown())
  }

  const importFile = async (file: File | undefined) => {
    if (!file || !editor) return
    try {
      await editor.importMarkdown(await file.text())
      toast.success(`Imported ${file.name}`)
    } catch (error) {
      toastApiError(error, 'Could not import the Markdown file')
    }
  }

  const lastEditor = page.last_edited_by ? displayNameOf(page.last_edited_by) : null

  return (
    <>
      <DropdownMenu>
        <Tip label="Style, export, and more">
          <DropdownMenuTrigger asChild>
            <TopbarButton aria-label="Page options">
              <MoreHorizontal />
            </TopbarButton>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-[260px]">
          {canEdit && isDocument && (
            <>
              <div role="group" aria-label="Font" className="flex gap-1.5 px-2 pt-1.5 pb-1">
                {FONTS.map(font => (
                  <DropdownMenuItem
                    key={font.value}
                    role="menuitemradio"
                    aria-checked={page.font === font.value}
                    aria-label={font.label}
                    onSelect={event => {
                      event.preventDefault()
                      void updatePage(page.id, { font: font.value })
                    }}
                    className={cn(
                      'mx-0 h-[58px] w-auto flex-1 flex-col justify-center gap-0.5 px-0 py-1',
                      page.font === font.value && 'text-primary bg-primary/10'
                    )}
                  >
                    <span className={cn('text-[22px] leading-none', font.className)}>
                      {font.sample}
                    </span>
                    <span className="text-[12px]">{font.label}</span>
                  </DropdownMenuItem>
                ))}
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          {canEdit && (
            <>
              {isDocument && (
                <ToggleRow
                  label="Small text"
                  checked={page.small_text}
                  onToggle={() => void updatePage(page.id, { small_text: !page.small_text })}
                />
              )}
              <ToggleRow
                label="Full width"
                checked={page.full_width}
                onToggle={() => void updatePage(page.id, { full_width: !page.full_width })}
              />
              <ToggleRow
                label="Lock page"
                checked={page.locked}
                onToggle={() => void updatePage(page.id, { locked: !page.locked })}
              />
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => void toggleFavorite(page, !page.is_favorite)}>
            {page.is_favorite ? <StarOff /> : <Star />}
            {page.is_favorite ? 'Remove from Favorites' : 'Add to Favorites'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyLink(page.id)}>
            <Link2 />
            Copy link
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuItem onSelect={() => void duplicatePage(page)}>
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openMoveTo(page)}>
                <CornerUpRight />
                Move to
              </DropdownMenuItem>
            </>
          )}
          {isDocument && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!editor} onSelect={exportMarkdown}>
                <Download />
                Export Markdown
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem
                  disabled={!editor || page.locked}
                  onSelect={() => fileInput.current?.click()}
                >
                  <Upload />
                  Import Markdown
                </DropdownMenuItem>
              )}
            </>
          )}
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void deletePage(page)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <div className="text-subtle px-3 py-1.5 text-[12px] leading-snug">
            {lastEditor ? (
              <>
                Last edited by {lastEditor}
                <br />
                {formatDateTime(page.last_edited_at)}
              </>
            ) : (
              <>Created {formatDateTime(page.created_at)}</>
            )}
            <span className="sr-only"> on {pageLabel(page)}</span>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInput}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        aria-label="Import Markdown file"
        data-testid="import-markdown-input"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void importFile(file)
        }}
      />
    </>
  )
}
