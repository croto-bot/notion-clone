import { Avatar } from '@/components/Avatar'
import type { PresenceUser } from '@/hooks/useCollabSession'

/** The other people on this page right now, as overlapping avatars (max 4, then "+n"). */
export function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null
  const shown = users.slice(0, 4)
  const extra = users.length - shown.length
  return (
    <div
      role="group"
      aria-label="People on this page"
      data-testid="presence-avatars"
      className="mr-1 flex items-center -space-x-1.5"
    >
      {shown.map(user => (
        <Avatar
          key={user.id}
          name={user.name}
          color={user.color}
          size={24}
          className="ring-background ring-2"
        />
      ))}
      {extra > 0 && (
        <span
          title={`${extra} more`}
          className="bg-hover-strong text-muted-foreground ring-background inline-flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ring-2"
        >
          +{extra}
        </span>
      )}
    </div>
  )
}
