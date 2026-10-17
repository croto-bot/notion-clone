import { useState, type ComponentType } from 'react'
import { ChevronDown, Kanban, LayoutGrid, List, Plus, Table2, Trash2 } from 'lucide-react'
import { DatabaseBoard } from '@/components/DatabaseBoard'
import { DatabaseGallery } from '@/components/DatabaseGallery'
import { DatabaseList } from '@/components/DatabaseList'
import { DatabaseTable } from '@/components/DatabaseTable'
import { FilterPopover } from '@/components/FilterPopover'
import { PropertiesPopover } from '@/components/PropertiesPopover'
import { SortPopover } from '@/components/SortPopover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DatabaseProvider, useDatabase } from '@/contexts/DatabaseContext'
import { buildDatabaseContext, type DatabaseInput } from '@/features/database/context-value'
import { applyView } from '@/features/database/filter-sort'
import {
  VIEW_TYPES,
  createView,
  firstSelect,
  groupProperty,
  viewsOf,
} from '@/features/database/properties'
import { cn } from '@/lib/utils'
import type { DatabaseView, ViewType } from '@/types/database'

const VIEW_KEY = 'nx-db-view:'

const VIEW_ICON: Record<ViewType, ComponentType<{ className?: string }>> = {
  table: Table2,
  board: Kanban,
  list: List,
  gallery: LayoutGrid,
}

function readActive(databaseId: string): string | null {
  try {
    return localStorage.getItem(VIEW_KEY + databaseId)
  } catch {
    return null
  }
}

function storeActive(databaseId: string, viewId: string) {
  try {
    localStorage.setItem(VIEW_KEY + databaseId, viewId)
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
}

function ViewIcon({ type }: { type: ViewType }) {
  const Icon = VIEW_ICON[type]
  return <Icon className="size-4 shrink-0" />
}

function ViewOptions({ view }: { view: DatabaseView }) {
  const { schema, views, editable, updateView, saveViews, setActiveView } = useDatabase()
  const selects = schema.filter(property => property.type === 'select')
  const canDelete = views.length > 1

  const setType = (type: ViewType) => {
    const next = { ...view, type }
    if (type === 'board' && !next.group_by) next.group_by = firstSelect(schema)?.id ?? null
    updateView(next)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`View options for ${view.name}`}
          className="text-muted-foreground hover:bg-hover grid size-5 place-items-center rounded-[3px]"
        >
          <ChevronDown className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-1.5">
        {editable && (
          <input
            aria-label="View name"
            defaultValue={view.name}
            onBlur={event => {
              const name = event.target.value.trim()
              if (name && name !== view.name) updateView({ ...view, name })
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className="bg-input mb-1 h-8 w-full rounded-[4px] px-2 text-[14px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none"
          />
        )}
        <div className="text-subtle px-2 pt-1 pb-1 text-[12px] font-medium">Layout</div>
        <div className="grid grid-cols-4 gap-1 px-1 pb-1">
          {VIEW_TYPES.map(item => (
            <button
              key={item.type}
              type="button"
              aria-label={item.label}
              aria-pressed={view.type === item.type}
              disabled={!editable}
              onClick={() => setType(item.type)}
              className={cn(
                'hover:bg-hover flex h-8 items-center justify-center rounded-[4px] disabled:opacity-50',
                view.type === item.type && 'bg-selected'
              )}
            >
              <ViewIcon type={item.type} />
            </button>
          ))}
        </div>
        {view.type === 'board' && (
          <label className="mt-1 block px-1 pb-1 text-[12px]">
            <span className="text-subtle px-1 font-medium">Group by</span>
            <select
              aria-label="Group by"
              value={groupProperty(view, schema)?.id ?? ''}
              disabled={!editable || selects.length === 0}
              onChange={event => updateView({ ...view, group_by: event.target.value || null })}
              className="bg-input mt-1 h-8 w-full rounded-[4px] px-1.5 text-[13px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none"
            >
              {selects.length === 0 && <option value="">No select property</option>}
              {selects.map(property => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {editable && canDelete && (
          <button
            type="button"
            onClick={() => {
              const next = views.filter(item => item.id !== view.id)
              saveViews(next)
              setActiveView(next[0]?.id ?? '')
            }}
            className="text-destructive hover:bg-hover flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-[14px]"
          >
            <Trash2 className="size-4" />
            Delete view
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ViewTabs() {
  const { views, view, editable, schema, setActiveView, saveViews } = useDatabase()

  const add = (type: ViewType) => {
    const added = createView(type, views, schema)
    saveViews([...views, added])
    setActiveView(added.id)
  }

  return (
    <div role="tablist" aria-label="Database views" className="flex min-w-0 items-center gap-0.5">
      {views.map(item => {
        const active = item.id === view.id
        return (
          <div key={item.id} className="flex items-center">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveView(item.id)}
              className={cn(
                'flex h-7 max-w-[160px] items-center gap-1.5 rounded-[4px] px-2 text-[14px] transition-colors duration-75',
                active ? 'bg-selected font-medium' : 'text-muted-foreground hover:bg-hover'
              )}
            >
              <ViewIcon type={item.type} />
              <span className="truncate">{item.name}</span>
            </button>
            {editable && active && <ViewOptions view={item} />}
          </div>
        )
      })}
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Add a view"
              className="text-muted-foreground hover:bg-hover grid size-7 place-items-center rounded-[4px]"
            >
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[180px]">
            {VIEW_TYPES.map(item => (
              <DropdownMenuItem key={item.type} onSelect={() => add(item.type)}>
                <ViewIcon type={item.type} />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function DatabaseBody() {
  const { view, rows, allRows } = useDatabase()
  return (
    <>
      {rows.length === 0 && allRows.length > 0 && (
        <p className="text-muted-foreground mb-2 text-[13px]">No rows match the filter.</p>
      )}
      {view.type === 'board' && <DatabaseBoard />}
      {view.type === 'list' && <DatabaseList />}
      {view.type === 'gallery' && <DatabaseGallery />}
      {view.type === 'table' && <DatabaseTable />}
    </>
  )
}

export function DatabaseFrame(
  props: Omit<DatabaseInput, 'view' | 'rows' | 'setActiveView' | 'views'> & {
    storedViews: DatabaseView[]
  }
) {
  const views = viewsOf(props.storedViews)
  const [activeId, setActiveId] = useState<string | null>(() => readActive(props.databaseId))
  const view = views.find(item => item.id === activeId) ?? views[0]
  const setActiveView = (viewId: string) => {
    setActiveId(viewId)
    storeActive(props.databaseId, viewId)
  }
  const rows = applyView(props.allRows, props.schema, view)
  const value = buildDatabaseContext({
    ...props,
    views,
    view,
    rows,
    setActiveView,
  })

  return (
    <DatabaseProvider value={value}>
      <div data-testid="database-view" className="min-w-0 pb-16">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <ViewTabs />
          <div className="ml-auto flex items-center gap-0.5">
            <FilterPopover />
            <SortPopover />
            <PropertiesPopover />
            {props.editable && !props.isPublic && (
              <button
                type="button"
                aria-label="New row"
                onClick={() => void props.onCreateRow()}
                className="bg-primary text-primary-foreground hover:bg-primary-hover ml-1 flex h-7 items-center gap-1 rounded-[4px] px-2 text-[14px] font-medium"
              >
                <Plus className="size-4" />
                New
              </button>
            )}
          </div>
        </div>
        <DatabaseBody />
      </div>
    </DatabaseProvider>
  )
}
