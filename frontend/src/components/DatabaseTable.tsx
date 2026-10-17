import { useEffect, useState } from 'react'
import { Copy, ExternalLink, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { AddPropertyMenu } from '@/components/AddPropertyMenu'
import { PageIcon } from '@/components/PageIcon'
import { PropertyCell } from '@/components/PropertyCell'
import { PropertyIcon } from '@/components/PropertyIcon'
import { PropertyMenu } from '@/components/PropertyMenu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDatabase } from '@/contexts/DatabaseContext'
import { usePageActions } from '@/hooks/usePageActions'
import { visibleProperties, type RowLike } from '@/features/database/properties'
import { UNTITLED } from '@/features/pages/page-tree'
import { consumeTitleFocus, peekTitleFocus } from '@/lib/title-focus'
import { cn } from '@/lib/utils'

const TITLE_WIDTH = 300
const COLUMN_WIDTH = 180
const ADD_WIDTH = 44

function TitleCell({ row }: { row: RowLike }) {
  const { editable, isPublic, setRowValue, schema, openRow } = useDatabase()
  const title = schema.find(property => property.type === 'title')
  // A row just created with "New" opens with the cursor in its title.
  const [draft, setDraft] = useState<string | null>(() =>
    peekTitleFocus(row.id) ? row.title : null
  )
  useEffect(() => {
    consumeTitleFocus(row.id)
  }, [row.id])
  const label = row.title.trim() ? row.title : UNTITLED

  const finish = (save: boolean) => {
    const next = draft ?? row.title
    setDraft(null)
    if (save && title && next !== row.title) setRowValue(row, title, next)
  }

  return (
    <div className="group/title flex h-[33px] items-center">
      <PageIcon icon={row.icon} size={18} className="ml-2 shrink-0" />
      {draft !== null ? (
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the user's click, or by "New"
          autoFocus
          aria-label="Row title"
          value={draft}
          placeholder="Untitled"
          onChange={event => setDraft(event.target.value)}
          onFocus={event => event.target.select()}
          onBlur={() => finish(true)}
          onKeyDown={event => {
            if (event.key === 'Enter') finish(true)
            else if (event.key === 'Escape') finish(false)
            event.stopPropagation()
          }}
          className="bg-background h-[33px] min-w-0 flex-1 px-1.5 text-[14px] leading-[20px] font-medium shadow-[inset_0_0_0_2px_rgba(35,131,226,0.6)] outline-none"
        />
      ) : (
        <button
          type="button"
          aria-label={`Title: ${label}`}
          disabled={!editable}
          onClick={() => setDraft(row.title)}
          className="h-[33px] min-w-0 flex-1 cursor-text px-1.5 text-left text-[14px] leading-[20px] font-medium disabled:cursor-default"
        >
          <span className={cn('block truncate', !row.title.trim() && 'text-subtle font-normal')}>
            {label}
          </span>
        </button>
      )}
      {!isPublic && draft === null && (
        <button
          type="button"
          aria-label={`Open ${label}`}
          onClick={() => openRow(row.id)}
          className="bg-background text-muted-foreground hover:bg-hover mr-1.5 flex h-6 shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[12px] font-medium opacity-0 shadow-[0_0_0_1px_var(--border)] group-hover/title:opacity-100 focus-visible:opacity-100"
        >
          <ExternalLink className="size-3.5" />
          Open
        </button>
      )}
    </div>
  )
}

function RowMenu({ row }: { row: RowLike }) {
  const { openRow } = useDatabase()
  const { deletePage, duplicatePage } = usePageActions()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Row options for ${row.title || UNTITLED}`}
          className="text-muted-foreground hover:bg-hover-strong grid size-6 place-items-center rounded-[4px] opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        <DropdownMenuItem onSelect={() => openRow(row.id)}>
          <ExternalLink />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void duplicatePage(row)}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void deletePage(row)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The table view: one line per row, one column per visible property, "+ New" at the bottom. */
export function DatabaseTable() {
  const { schema, view, rows, editable, isPublic, createRow } = useDatabase()
  const props = visibleProperties(view, schema)
  const title = props.find(property => property.type === 'title')
  const others = props.filter(property => property.type !== 'title')
  const columns = `${TITLE_WIDTH}px ${others.map(() => `${COLUMN_WIDTH}px`).join(' ')} ${editable ? `${ADD_WIDTH}px` : ''}`
  const width = TITLE_WIDTH + others.length * COLUMN_WIDTH + (editable ? ADD_WIDTH : 0)

  return (
    <div className="nx-scroll -ml-8 overflow-x-auto pb-2 pl-8" data-testid="database-table">
      <div role="table" aria-label="Table" style={{ minWidth: width }}>
        <div
          role="row"
          className="grid h-[33px] border-y text-[14px]"
          style={{ gridTemplateColumns: columns }}
        >
          {[title, ...others].map(property =>
            property ? (
              <div key={property.id} role="columnheader" className="min-w-0 border-r">
                <PropertyMenu property={property}>
                  <button
                    type="button"
                    className="text-muted-foreground hover:bg-hover flex h-[33px] w-full min-w-0 items-center gap-1.5 px-2 text-left text-[14px] font-medium transition-colors duration-75 [&_svg]:size-4 [&_svg]:shrink-0"
                  >
                    <PropertyIcon type={property.type} />
                    <span className="truncate">{property.name}</span>
                  </button>
                </PropertyMenu>
              </div>
            ) : null
          )}
          {editable && (
            <AddPropertyMenu>
              <button
                type="button"
                aria-label="Add a property"
                className="text-muted-foreground hover:bg-hover grid h-[33px] place-items-center transition-colors duration-75"
              >
                <Plus className="size-4" />
              </button>
            </AddPropertyMenu>
          )}
        </div>

        {rows.map(row => (
          <div
            key={row.id}
            role="row"
            data-row-id={row.id}
            aria-label={row.title || UNTITLED}
            className="group/row hover:bg-hover/50 relative grid h-[33px] border-b text-[14px]"
            style={{ gridTemplateColumns: columns }}
          >
            <div role="cell" className="relative border-r">
              {editable && !isPublic && (
                <div className="absolute top-[5px] -left-7 z-10">
                  <RowMenu row={row} />
                </div>
              )}
              <TitleCell row={row} />
            </div>
            {others.map(property => (
              <div key={property.id} role="cell" className="min-w-0 border-r last:border-r-0">
                <PropertyCell row={row} property={property} />
              </div>
            ))}
            {editable && <div role="cell" />}
          </div>
        ))}

        {editable && (
          <button
            type="button"
            aria-label="Add a row"
            onClick={() => void createRow()}
            className="text-subtle hover:bg-hover flex h-[33px] w-full items-center gap-2 border-b px-2 text-left text-[14px] transition-colors duration-75"
            style={{ minWidth: width }}
          >
            <Plus className="size-4" />
            New
          </button>
        )}
      </div>
    </div>
  )
}
