import { useRef, useState } from 'react'
import type { ClassValue } from 'clsx'
import { Check, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { OptionChip } from '@/components/OptionChip'
import { PropertyValueView } from '@/components/PropertyValueView'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDatabase } from '@/contexts/DatabaseContext'
import {
  OPTION_COLORS,
  createOption,
  isComputedType,
  isEmptyValue,
  optionsOf,
  readValue,
  toBool,
  toDate,
  toIds,
  toNumber,
  toText,
  type RowLike,
} from '@/features/database/properties'
import { displayNameOf } from '@/hooks/useUser'
import { cn } from '@/lib/utils'
import type { DatabaseProperty, DateValue, PropertyValue, SelectOption } from '@/types/database'

type Variant = 'cell' | 'panel'

/**
 * The box of one value. Table cells take 32 px inside the row's 1 px border
 * (33 px like Notion) and grow with wrapped content (multi-select chips,
 * people); panel lines hug their row.
 */
function cellBox(variant: Variant, ...className: ClassValue[]) {
  return cn(
    'flex w-full px-2 text-left text-[14px] leading-[20px]',
    variant === 'panel' ? 'min-h-[32px] items-start py-1.5' : 'min-h-[32px] items-center py-[6px]',
    className
  )
}

interface EditorProps {
  row: RowLike
  property: DatabaseProperty
  value: PropertyValue
  variant: Variant
  editable: boolean
  commit: (value: PropertyValue) => void
}

/** Text, URL and number: shows the value, a click turns it into an input. */
function InlineInputCell({ property, value, variant, editable, commit }: EditorProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const done = useRef(false)
  const isNumber = property.type === 'number'
  const text = isNumber ? (toNumber(value)?.toString() ?? '') : toText(value)

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const next = draft ?? text
    setDraft(null)
    if (!save || next === text) return
    if (isNumber) {
      const trimmed = next.trim()
      if (trimmed === '') return commit(null)
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) commit(parsed)
      return
    }
    commit(next)
  }

  if (draft !== null) {
    return (
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the user's click on the cell
        autoFocus
        aria-label={property.name}
        value={draft}
        inputMode={isNumber ? 'decimal' : undefined}
        onChange={event => setDraft(event.target.value)}
        onFocus={event => event.target.setSelectionRange(draft.length, draft.length)}
        onBlur={() => finish(true)}
        onKeyDown={event => {
          if (event.key === 'Enter') finish(true)
          else if (event.key === 'Escape') finish(false)
          event.stopPropagation()
        }}
        className="bg-background h-[33px] w-full px-2 text-[14px] leading-[20px] shadow-[inset_0_0_0_2px_rgba(35,131,226,0.6)] outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      aria-label={`${property.name}: ${text || 'empty'}`}
      disabled={!editable}
      onClick={() => {
        done.current = false
        setDraft(text)
      }}
      className={cellBox(
        variant,
        'cursor-text disabled:cursor-default',
        variant === 'panel' && 'rounded-[4px] hover:bg-hover'
      )}
    >
      {text ? (
        <span
          className={cn(
            'min-w-0 truncate',
            property.type === 'url' && 'underline decoration-[var(--subtle)] underline-offset-2'
          )}
        >
          {text}
        </span>
      ) : variant === 'panel' ? (
        <span className="text-subtle">Empty</span>
      ) : null}
    </button>
  )
}

function CheckboxCell({ property, value, variant, editable, commit }: EditorProps) {
  const checked = toBool(value)
  return (
    // In the panel the checkbox lines up with the 34 px label row, centered
    // like Notion's row properties; the table centers it in the cell already.
    <div className={cellBox(variant, variant === 'panel' && 'min-h-[34px] items-center py-0')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={property.name}
        disabled={!editable}
        onClick={() => commit(!checked)}
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-[3px] border-[1.5px] transition-colors duration-100 disabled:cursor-default',
          checked ? 'bg-primary border-primary text-white' : 'border-foreground/60 hover:bg-hover'
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </button>
    </div>
  )
}

function OptionEditor({
  option,
  onChange,
  onDelete,
}: {
  option: SelectOption
  onChange: (option: SelectOption) => void
  onDelete: () => void
}) {
  return (
    <div className="w-[220px] p-2">
      <input
        aria-label="Option name"
        defaultValue={option.name}
        onBlur={event => {
          const name = event.target.value.trim()
          if (name && name !== option.name) onChange({ ...option, name })
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className="bg-input h-7 w-full rounded-[4px] px-2 text-[14px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(35,131,226,0.57)]"
      />
      <button
        type="button"
        onClick={onDelete}
        className="text-destructive hover:bg-hover mt-1.5 flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-[14px]"
      >
        <Trash2 className="size-4" />
        Delete
      </button>
      <div className="text-subtle mt-2 mb-1 px-1 text-[12px] font-medium">Colors</div>
      <div className="grid grid-cols-5 gap-1">
        {OPTION_COLORS.map(color => (
          <button
            key={color}
            type="button"
            aria-label={`Color ${color}`}
            aria-pressed={option.color === color}
            onClick={() => onChange({ ...option, color })}
            className="grid h-7 place-items-center rounded-[4px] hover:bg-hover"
          >
            <span
              data-color={color}
              className={cn(
                'nx-chip nx-dot grid size-[18px] place-items-center rounded-full',
                option.color === color &&
                  'ring-foreground/60 ring-2 ring-offset-1 ring-offset-popover'
              )}
              style={{ background: 'var(--chip-dot)' }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

/** The options list of a select: pick, search, create, rename, recolor and delete options. */
function OptionsList({
  property,
  selected,
  multi,
  onPick,
  onOptions,
  onCreate,
}: {
  property: DatabaseProperty
  selected: string[]
  multi: boolean
  onPick: (id: string) => void
  onOptions: (options: SelectOption[]) => void
  onCreate: (option: SelectOption) => void
}) {
  const [query, setQuery] = useState('')
  const options = optionsOf(property)
  const needle = query.trim().toLowerCase()
  const filtered = options.filter(option => option.name.toLowerCase().includes(needle))
  const exact = options.find(option => option.name.toLowerCase() === needle)
  const canCreate = needle !== '' && !exact

  const submit = () => {
    if (exact) onPick(exact.id)
    else if (canCreate) {
      onCreate(createOption(query.trim(), options))
      setQuery('')
    } else if (filtered[0]) onPick(filtered[0].id)
  }

  return (
    <div className="w-[260px]">
      <div className="border-b p-2">
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the popover opens for choosing an option
          autoFocus
          aria-label="Search or create an option"
          placeholder="Search for an option…"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          className="placeholder:text-subtle h-6 w-full bg-transparent text-[14px] outline-none"
        />
      </div>
      <div className="text-subtle px-3 pt-2 pb-1 text-[12px] font-medium">
        {multi ? 'Select options or create one' : 'Select an option or create one'}
      </div>
      <ul className="nx-scroll max-h-[260px] overflow-y-auto px-1 pb-1">
        {filtered.map(option => (
          <li
            key={option.id}
            className="group/option flex items-center rounded-[4px] hover:bg-hover"
          >
            <button
              type="button"
              aria-label={option.name}
              aria-pressed={selected.includes(option.id)}
              onClick={() => onPick(option.id)}
              className="flex min-h-[28px] min-w-0 flex-1 items-center gap-2 px-2 py-0.5 text-left"
            >
              <OptionChip option={option} />
              {selected.includes(option.id) && (
                <Check className="text-muted-foreground ml-auto size-4" />
              )}
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Edit option ${option.name}`}
                  className="text-muted-foreground hover:bg-pressed mr-1 grid size-6 place-items-center rounded-[4px] opacity-0 group-focus-within/option:opacity-100 group-hover/option:opacity-100"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-auto p-0">
                <OptionEditor
                  option={option}
                  onChange={next =>
                    onOptions(options.map(item => (item.id === next.id ? next : item)))
                  }
                  onDelete={() => onOptions(options.filter(item => item.id !== option.id))}
                />
              </PopoverContent>
            </Popover>
          </li>
        ))}
        {canCreate && (
          <li>
            <button
              type="button"
              onClick={submit}
              className="hover:bg-hover flex min-h-[28px] w-full items-center gap-2 rounded-[4px] px-2 py-0.5 text-left text-[14px]"
            >
              <Plus className="text-muted-foreground size-4" />
              Create
              <OptionChip option={{ name: query.trim(), color: 'default' }} />
            </button>
          </li>
        )}
        {filtered.length === 0 && !canCreate && (
          <li className="text-subtle px-2 py-1.5 text-[13px]">
            No options yet. Type a name to create one.
          </li>
        )}
      </ul>
    </div>
  )
}

function SelectCell({ property, value, variant, editable, commit, row }: EditorProps) {
  const { updateProperty, members } = useDatabase()
  const [open, setOpen] = useState(false)
  const multi = property.type === 'multi_select'
  const ids = toIds(value)

  const pick = (id: string) => {
    if (multi) commit(ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])
    else {
      commit(ids[0] === id ? null : id)
      setOpen(false)
    }
  }

  const display = <PropertyValueView property={property} value={value} members={members} />

  if (!editable) return <div className={cellBox(variant)}>{display}</div>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${property.name} of ${row.title || 'Untitled'}`}
          className={cellBox(
            variant,
            'cursor-pointer',
            variant === 'panel' && 'rounded-[4px] hover:bg-hover'
          )}
        >
          {isEmptyValue(property, value) && variant === 'panel' ? (
            <span className="text-subtle">Empty</span>
          ) : (
            display
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <OptionsList
          property={property}
          selected={ids}
          multi={multi}
          onPick={pick}
          onOptions={options => updateProperty({ ...property, options })}
          onCreate={option => {
            // The option must exist in the schema before any row references
            // it: wait for that save, and keep the row untouched when it
            // fails, so an option id missing from the schema is never stored.
            void updateProperty({ ...property, options: [...optionsOf(property), option] }).then(
              ok => {
                if (!ok) return
                if (multi) commit([...ids, option.id])
                else {
                  commit(option.id)
                  setOpen(false)
                }
              }
            )
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function DateCell({ property, value, variant, editable, commit, row }: EditorProps) {
  const date = toDate(value)
  const [open, setOpen] = useState(false)
  const show = <PropertyValueView property={property} value={value} />

  if (!editable) return <div className={cellBox(variant)}>{show}</div>
  const setDate = (next: DateValue | null) => commit(next)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${property.name} of ${row.title || 'Untitled'}`}
          className={cellBox(
            variant,
            'cursor-pointer',
            variant === 'panel' && 'rounded-[4px] hover:bg-hover'
          )}
        >
          {date ? show : variant === 'panel' ? <span className="text-subtle">Empty</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] space-y-2 p-3">
        <label className="block text-[12px] font-medium">
          <span className="text-muted-foreground">{date?.end ? 'Start date' : 'Date'}</span>
          <input
            type="date"
            aria-label="Date"
            value={date?.start.slice(0, 10) ?? ''}
            onChange={event => {
              const start = event.target.value
              setDate(start ? { start, ...(date?.end ? { end: date.end } : {}) } : null)
            }}
            className="bg-input mt-1 h-8 w-full rounded-[4px] px-2 text-[14px] font-normal shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={!!date?.end}
            disabled={!date}
            onChange={event => {
              if (!date) return
              setDate({ start: date.start, ...(event.target.checked ? { end: date.start } : {}) })
            }}
          />
          End date
        </label>
        {date?.end && (
          <input
            type="date"
            aria-label="End date"
            value={date.end.slice(0, 10)}
            min={date.start.slice(0, 10)}
            onChange={event => setDate({ start: date.start, end: event.target.value || undefined })}
            className="bg-input h-8 w-full rounded-[4px] px-2 text-[14px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none"
          />
        )}
        <button
          type="button"
          onClick={() => {
            setDate(null)
            setOpen(false)
          }}
          className="hover:bg-hover text-muted-foreground h-7 w-full rounded-[4px] text-left text-[14px]"
        >
          Clear
        </button>
      </PopoverContent>
    </Popover>
  )
}

function PersonCell({ property, value, variant, editable, commit, row }: EditorProps) {
  const { members } = useDatabase()
  const ids = toIds(value)
  const display = <PropertyValueView property={property} value={value} members={members} />

  if (!editable) return <div className={cellBox(variant)}>{display}</div>
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${property.name} of ${row.title || 'Untitled'}`}
          className={cellBox(
            variant,
            'cursor-pointer',
            variant === 'panel' && 'rounded-[4px] hover:bg-hover'
          )}
        >
          {ids.length === 0 && variant === 'panel' ? (
            <span className="text-subtle">Empty</span>
          ) : (
            display
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-1">
        <div className="text-subtle px-2 pt-1.5 pb-1 text-[12px] font-medium">Select people</div>
        <ul className="nx-scroll max-h-[240px] overflow-y-auto">
          {members.map(member => {
            const picked = ids.includes(member.user_id)
            return (
              <li key={member.user_id}>
                <button
                  type="button"
                  aria-pressed={picked}
                  aria-label={displayNameOf(member)}
                  onClick={() =>
                    commit(
                      picked ? ids.filter(id => id !== member.user_id) : [...ids, member.user_id]
                    )
                  }
                  className="hover:bg-hover flex min-h-[32px] w-full items-center gap-2 rounded-[4px] px-2 text-left"
                >
                  <Avatar name={displayNameOf(member)} seed={member.user_id} size={20} />
                  <span className="min-w-0 flex-1 truncate">{displayNameOf(member)}</span>
                  {picked && <Check className="text-muted-foreground size-4" />}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

interface PropertyCellProps {
  row: RowLike
  property: DatabaseProperty
  /** `cell` is a table cell; `panel` is a line of the row page's property list. */
  variant?: Variant
}

/** One value of one row, editable in place according to the property type. */
export function PropertyCell({ row, property, variant = 'cell' }: PropertyCellProps) {
  const { editable, setRowValue, members } = useDatabase()
  const value = readValue(row, property)
  const canEdit = editable && !isComputedType(property.type)
  const props: EditorProps = {
    row,
    property,
    value,
    variant,
    editable: canEdit,
    commit: next => setRowValue(row, property, next),
  }

  switch (property.type) {
    case 'checkbox':
      return <CheckboxCell {...props} />
    case 'select':
    case 'multi_select':
      return <SelectCell {...props} />
    case 'date':
      return <DateCell {...props} />
    case 'person':
      return <PersonCell {...props} />
    case 'created_time':
    case 'last_edited_time':
      return (
        <div className={cellBox(variant, 'text-muted-foreground')}>
          <PropertyValueView property={property} value={value} members={members} />
        </div>
      )
    default:
      return <InlineInputCell {...props} />
  }
}
