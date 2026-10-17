import { Check } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { OptionChip } from '@/components/OptionChip'
import {
  findOption,
  formatDateValue,
  toBool,
  toDate,
  toIds,
  toNumber,
  toText,
} from '@/features/database/properties'
import { displayNameOf } from '@/hooks/useUser'
import { formatDateTime } from '@/lib/time'
import type { DatabaseProperty, PropertyValue } from '@/types/database'
import type { Member } from '@/types/workspace'

interface PropertyValueViewProps {
  property: DatabaseProperty
  value: PropertyValue
  members?: Member[]
}

/** A value as plain display (no editing): chips, a date, a check, an avatar list. */
export function PropertyValueView({ property, value, members = [] }: PropertyValueViewProps) {
  switch (property.type) {
    case 'select':
    case 'multi_select': {
      const options = toIds(value).flatMap(id => {
        const option = findOption(property, id)
        return option ? [option] : []
      })
      if (options.length === 0) return null
      return (
        <span className="flex flex-wrap gap-1">
          {options.map(option => (
            <OptionChip key={option.id} option={option} />
          ))}
        </span>
      )
    }
    case 'checkbox':
      return toBool(value) ? (
        <span className="bg-primary inline-grid size-4 place-items-center rounded-[3px] text-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : (
        <span className="border-foreground/60 inline-block size-4 rounded-[3px] border-[1.5px]" />
      )
    case 'date': {
      const date = toDate(value)
      return date ? <span>{formatDateValue(date)}</span> : null
    }
    case 'number': {
      const number = toNumber(value)
      return number === null ? null : <span>{number}</span>
    }
    case 'person': {
      const people = toIds(value).flatMap(id => {
        const member = members.find(item => item.user_id === id)
        return member ? [member] : []
      })
      if (people.length === 0) return null
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {people.map(member => (
            <span key={member.user_id} className="inline-flex items-center gap-1">
              <Avatar name={displayNameOf(member)} seed={member.user_id} size={18} />
              <span>{displayNameOf(member)}</span>
            </span>
          ))}
        </span>
      )
    }
    case 'created_time':
    case 'last_edited_time': {
      const text = toText(value)
      return text ? <span>{formatDateTime(text)}</span> : null
    }
    case 'url': {
      const text = toText(value)
      return text ? (
        <span className="underline decoration-[var(--subtle)] underline-offset-2">{text}</span>
      ) : null
    }
    default: {
      const text = toText(value)
      return text ? <span className="whitespace-pre-wrap">{text}</span> : null
    }
  }
}
