import {
  AlignLeft,
  Calendar,
  CheckSquare,
  ChevronDownCircle,
  Clock,
  Hash,
  Link2,
  ListChecks,
  Type,
  User,
} from 'lucide-react'
import type { PropertyType } from '@/types/database'

const ICONS: Record<PropertyType, React.ComponentType<{ className?: string }>> = {
  title: Type,
  text: AlignLeft,
  number: Hash,
  select: ChevronDownCircle,
  multi_select: ListChecks,
  date: Calendar,
  checkbox: CheckSquare,
  url: Link2,
  person: User,
  created_time: Clock,
  last_edited_time: Clock,
}

/** The small glyph of a property type, shown next to its name. */
export function PropertyIcon({ type, className }: { type: PropertyType; className?: string }) {
  const Icon = ICONS[type]
  return <Icon className={className ?? 'size-4'} />
}
