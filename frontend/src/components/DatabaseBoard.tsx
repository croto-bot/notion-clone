import { useState } from 'react'
import { GripVertical, Plus } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { OptionChip } from '@/components/OptionChip'
import { PageIcon } from '@/components/PageIcon'
import { PropertyValueView } from '@/components/PropertyValueView'
import { useDatabase } from '@/contexts/DatabaseContext'
import {
  groupProperty,
  optionsOf,
  readValue,
  toIds,
  visibleProperties,
  type RowLike,
} from '@/features/database/properties'
import { UNTITLED } from '@/features/pages/page-tree'
import { cn } from '@/lib/utils'

const NONE = 'none'

function columnKey(optionId: string | null): string {
  return `col:${optionId ?? NONE}`
}

function optionFromKey(key: string): string | null {
  const raw = key.slice(4)
  return raw === NONE ? null : raw
}

function BoardCard({ row, draggable }: { row: RowLike; draggable: boolean }) {
  const { schema, view, members, isPublic, openRow } = useDatabase()
  const group = groupProperty(view, schema)
  const label = row.title.trim() ? row.title : UNTITLED
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.id,
    disabled: !draggable,
  })
  const extras = visibleProperties(view, schema).filter(
    property => property.type !== 'title' && property.id !== group?.id
  )

  return (
    <div
      ref={setNodeRef}
      data-testid="board-card"
      data-row-id={row.id}
      className={cn(
        'bg-background rounded-[6px] p-2 shadow-[0_0_0_1px_var(--border),0_1px_2px_rgba(15,15,15,0.04)]',
        isDragging && 'opacity-40'
      )}
    >
      <div className="flex items-start gap-1">
        {draggable && (
          <button
            type="button"
            aria-label={`Drag ${label}`}
            className="text-subtle hover:bg-hover mt-0.5 grid size-5 shrink-0 cursor-grab place-items-center rounded-[3px] active:cursor-grabbing"
            {...listeners}
            {...attributes}
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
        <PageIcon icon={row.icon} size={18} className="mt-0.5" />
        {isPublic ? (
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{label}</span>
        ) : (
          <button
            type="button"
            onClick={() => openRow(row.id)}
            className="min-w-0 flex-1 truncate text-left text-[14px] font-medium"
          >
            {label}
          </button>
        )}
      </div>
      {extras.length > 0 && (
        <div className="mt-1.5 space-y-1 pl-6">
          {extras.slice(0, 4).map(property => (
            <div key={property.id} className="text-muted-foreground min-w-0 text-[12px]">
              <PropertyValueView
                property={property}
                value={readValue(row, property)}
                members={members}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BoardColumn({
  optionId,
  name,
  color,
  rows,
  draggable,
}: {
  optionId: string | null
  name: string
  color?: string
  rows: RowLike[]
  draggable: boolean
}) {
  const { editable, isPublic, createRow, view, schema } = useDatabase()
  const { setNodeRef, isOver } = useDroppable({ id: columnKey(optionId) })
  const group = groupProperty(view, schema)

  return (
    <div
      ref={setNodeRef}
      data-testid="board-column"
      data-column={optionId ?? NONE}
      className={cn(
        'bg-hover/70 flex w-[260px] shrink-0 flex-col rounded-[8px] p-2 transition-colors duration-100',
        isOver && 'bg-selected'
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 px-1">
        {optionId && color ? (
          <OptionChip option={{ name, color }} />
        ) : (
          <span className="text-muted-foreground truncate text-[13px] font-medium">{name}</span>
        )}
        <span className="text-subtle ml-auto text-[12px]">{rows.length}</span>
      </div>
      <div className="flex min-h-[48px] flex-1 flex-col gap-2">
        {rows.map(row => (
          <BoardCard key={row.id} row={row} draggable={draggable} />
        ))}
      </div>
      {editable && !isPublic && (
        <button
          type="button"
          aria-label={`New row in ${name}`}
          onClick={() => void createRow(group && optionId ? { [group.id]: optionId } : undefined)}
          className="text-subtle hover:bg-hover-strong mt-2 flex h-7 items-center gap-1.5 rounded-[4px] px-1.5 text-[13px]"
        >
          <Plus className="size-3.5" />
          New
        </button>
      )}
    </div>
  )
}

export function DatabaseBoard() {
  const { rows, schema, view, editable, isPublic, allRows, setRowValue } = useDatabase()
  const group = groupProperty(view, schema)
  const draggable = editable && !isPublic && !!group
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [activeId, setActiveId] = useState<string | null>(null)

  const columns = (() => {
    if (!group) return [{ optionId: null as string | null, name: 'No Status', rows }]
    const buckets = new Map<string, RowLike[]>()
    for (const option of optionsOf(group)) buckets.set(option.id, [])
    const none: RowLike[] = []
    for (const row of rows) {
      const [id] = toIds(readValue(row, group))
      const bucket = id ? buckets.get(id) : undefined
      if (bucket) bucket.push(row)
      else none.push(row)
    }
    return [
      ...optionsOf(group).map(option => ({
        optionId: option.id,
        name: option.name,
        color: option.color,
        rows: buckets.get(option.id) ?? [],
      })),
      { optionId: null, name: `No ${group.name}`, rows: none },
    ]
  })()

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id))
  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const overId = event.over?.id
    if (!group || typeof overId !== 'string' || !overId.startsWith('col:')) return
    const row = allRows.find(item => item.id === String(event.active.id))
    if (!row) return
    const next = optionFromKey(overId)
    const current = toIds(readValue(row, group))[0] ?? null
    if (current === next) return
    setRowValue(row, group, next)
  }

  const active = activeId ? rows.find(row => row.id === activeId) : undefined
  const body = (
    <div data-testid="database-board" className="flex items-start gap-3 overflow-x-auto pb-4">
      {columns.map(column => (
        <BoardColumn
          key={column.optionId ?? NONE}
          optionId={column.optionId}
          name={column.name}
          color={'color' in column ? column.color : undefined}
          rows={column.rows}
          draggable={draggable}
        />
      ))}
    </div>
  )

  if (!draggable) return body
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {body}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="bg-background w-[240px] rounded-[6px] p-2 text-[14px] font-medium shadow-menu">
            {active.title.trim() ? active.title : UNTITLED}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
