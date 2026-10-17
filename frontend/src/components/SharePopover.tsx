import { useState } from 'react'
import { Check, Copy, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { TopbarButton } from '@/components/Topbar'
import { useAppShell } from '@/contexts/AppShellContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePageActions } from '@/hooks/usePageActions'
import { displayNameOf, useCurrentUser } from '@/hooks/useUser'
import { useAddMember, useMembers } from '@/hooks/useWorkspaces'
import { copyText } from '@/lib/clipboard'
import { toastApiError } from '@/lib/error-handler'
import { cn } from '@/lib/utils'
import { ROLES, type Role } from '@/types/workspace'
import type { PageResponse } from '@/types/page'

type Tab = 'share' | 'publish'

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Full access',
  editor: 'Can edit',
  viewer: 'Can view',
}

function TabButton({
  id,
  tab,
  onSelect,
  children,
}: {
  id: Tab
  tab: Tab
  onSelect: (tab: Tab) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => onSelect(id)}
      className={cn(
        'relative h-9 px-3 text-[14px] font-medium transition-colors duration-100 focus-visible:outline-none',
        tab === id
          ? 'text-foreground after:bg-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-[2px]'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function ShareTab({ page }: { page: PageResponse }) {
  const { workspace, isOwner } = useWorkspace()
  const { data: me } = useCurrentUser()
  const { data: members = [] } = useMembers(workspace.id)
  const addMember = useAddMember(workspace.id)
  const { openSettings } = useAppShell()
  const { copyLink } = usePageActions()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')

  const invite = async (event: React.FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (!address) return
    try {
      await addMember.mutateAsync({ email: address, role })
      setEmail('')
      toast.success(`Added ${address} to ${workspace.name}`)
    } catch (error) {
      toastApiError(error, 'Could not add the member')
    }
  }

  return (
    <div className="p-3">
      {isOwner ? (
        <form onSubmit={invite} className="flex items-center gap-1.5">
          <Input
            type="email"
            aria-label="Invite by email"
            placeholder="Email address"
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
          <select
            aria-label="Role of the new member"
            value={role}
            onChange={event => setRole(event.target.value as Role)}
            className="bg-input h-8 rounded-[4px] px-1.5 text-[14px] shadow-[inset_0_0_0_1px_var(--input-ring)] outline-none"
          >
            {ROLES.map(item => (
              <option key={item} value={item}>
                {ROLE_LABEL[item]}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={!email.trim() || addMember.isPending}>
            Invite
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Everyone in {workspace.name} can open this page. Only the owner invites people.
        </p>
      )}

      <div className="text-subtle mt-3 mb-1 text-[12px] font-medium">
        People in {workspace.name}
      </div>
      <ul aria-label="Members" className="nx-scroll max-h-[200px] overflow-y-auto">
        {members.map(member => (
          <li key={member.user_id} className="flex items-center gap-2.5 py-1.5">
            <Avatar name={displayNameOf(member)} seed={member.user_id} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">
                {displayNameOf(member)}
                {member.user_id === me?.id && (
                  <span className="text-subtle font-normal"> (you)</span>
                )}
              </div>
              <div className="text-subtle truncate text-[12px]">{member.email}</div>
            </div>
            <span className="text-muted-foreground shrink-0 text-[13px]">
              {ROLE_LABEL[member.role]}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t pt-3">
        {isOwner ? (
          <button
            type="button"
            onClick={() => openSettings('members')}
            className="text-muted-foreground hover:text-foreground text-[13px] underline-offset-2 hover:underline"
          >
            Manage members
          </button>
        ) : (
          <span />
        )}
        <Button variant="outline" size="sm" onClick={() => void copyLink(page.id)}>
          <Copy />
          Copy link
        </Button>
      </div>
    </div>
  )
}

function PublishTab({ page }: { page: PageResponse }) {
  const { canEdit } = useWorkspace()
  const { updatePage } = usePageActions()
  const [copied, setCopied] = useState(false)
  const url = page.public_id ? `${window.location.origin}/share/${page.public_id}` : ''

  const copy = async () => {
    if (!(await copyText(url))) return void toast.error('Could not copy the link')
    setCopied(true)
    toast.success('Link copied')
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-3">
        <Globe className="text-muted-foreground size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">Publish to web</div>
          <div className="text-muted-foreground text-[12px]">
            Anyone with the link can read this page. No sign-in needed.
          </div>
        </div>
        <Switch
          aria-label="Publish to web"
          checked={page.is_public}
          disabled={!canEdit}
          onCheckedChange={checked => void updatePage(page.id, { is_public: checked })}
        />
      </div>
      {page.is_public && page.public_id && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5">
            <Input
              readOnly
              aria-label="Public link"
              value={url}
              onFocus={event => event.target.select()}
            />
            <Button variant="outline" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />}
              Copy link
            </Button>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-primary mt-2 inline-block text-[13px] underline-offset-2 hover:underline"
          >
            View site
          </a>
        </div>
      )}
    </div>
  )
}

/** The "Share" button of the top bar: invite workspace members, or publish the page to the web. */
export function SharePopover({ page }: { page: PageResponse }) {
  const [tab, setTab] = useState<Tab>('share')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <TopbarButton aria-label="Share" className="px-2 font-medium">
          Share
          {page.is_public && <Globe className="!size-3.5" />}
        </TopbarButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0">
        <div role="tablist" aria-label="Share options" className="flex border-b px-1">
          <TabButton id="share" tab={tab} onSelect={setTab}>
            Share
          </TabButton>
          <TabButton id="publish" tab={tab} onSelect={setTab}>
            Publish
          </TabButton>
        </div>
        {tab === 'share' ? <ShareTab page={page} /> : <PublishTab page={page} />}
      </PopoverContent>
    </Popover>
  )
}
