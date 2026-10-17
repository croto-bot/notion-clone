import { cn } from '@/lib/utils'
import type { SelectOption } from '@/types/database'

/** A select option as a colored pill. */
export function OptionChip({
  option,
  className,
}: {
  option: Pick<SelectOption, 'name' | 'color'>
  className?: string
}) {
  return (
    <span
      data-color={option.color}
      className={cn(
        'nx-chip inline-flex max-w-full items-center truncate rounded-[3px] px-1.5 py-px text-[13px] leading-[1.4]',
        className
      )}
    >
      <span className="truncate">{option.name}</span>
    </span>
  )
}
