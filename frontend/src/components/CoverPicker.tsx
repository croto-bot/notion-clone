import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { COVER_PRESETS } from '@/lib/colors'
import { cn } from '@/lib/utils'

interface CoverPickerProps {
  current: string | null
  onSelect: (cover: string) => void
  onRemove: () => void
}

type Tab = 'gallery' | 'link'

/** Cover choices: preset gradients and colors (no external images), or a link to an image. */
export function CoverPicker({ current, onSelect, onRemove }: CoverPickerProps) {
  const [tab, setTab] = useState<Tab>('gallery')
  const [url, setUrl] = useState('')
  const validUrl = /^https?:\/\/\S+$/i.test(url.trim())

  return (
    <div className="w-[400px]">
      <div className="flex items-center border-b px-2">
        <div role="tablist" aria-label="Cover source" className="flex flex-1">
          {(['gallery', 'link'] as const).map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'relative h-9 px-2.5 text-[14px] font-medium capitalize transition-colors duration-100',
                tab === id
                  ? 'text-foreground after:bg-foreground after:absolute after:inset-x-1.5 after:-bottom-px after:h-[2px]'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {id === 'link' ? 'Link' : 'Gallery'}
            </button>
          ))}
        </div>
        {current && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:bg-hover h-6 rounded-[4px] px-2 text-[13px]"
          >
            Remove
          </button>
        )}
      </div>
      {tab === 'gallery' ? (
        <div className="grid grid-cols-3 gap-2 p-3">
          {COVER_PRESETS.map(preset => (
            <button
              key={preset.key}
              type="button"
              aria-label={`Cover ${preset.label}`}
              onClick={() => onSelect(preset.key)}
              className={cn(
                'h-[52px] rounded-[4px] transition-transform duration-100 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                current === preset.key && 'ring-primary ring-2 ring-offset-1'
              )}
              style={{ background: preset.css }}
            />
          ))}
        </div>
      ) : (
        <form
          className="space-y-2 p-3"
          onSubmit={event => {
            event.preventDefault()
            if (validUrl) onSelect(url.trim())
          }}
        >
          <Input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the Link tab exists to paste a URL
            autoFocus
            aria-label="Image link"
            placeholder="Paste an image link…"
            value={url}
            onChange={event => setUrl(event.target.value)}
          />
          <Button type="submit" className="w-full" disabled={!validUrl}>
            Submit
          </Button>
          <p className="text-muted-foreground text-center text-[12px]">
            Works with any image link. Files are not uploaded.
          </p>
        </form>
      )}
    </div>
  )
}
