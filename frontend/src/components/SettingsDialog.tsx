import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Check,
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sun,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { EmojiPicker } from '@/components/EmojiPicker'
import { WorkspaceIcon } from '@/components/WorkspaceIcon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useAppShell, type SettingsTab } from '@/contexts/AppShellContext'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import type { Theme } from '@/lib/theme'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { displayNameOf, useCurrentUser, useUpdateCurrentUser } from '@/hooks/useUser'
import {
  useAddMember,
  useDeleteWorkspace,
  useMembers,
  useRemoveMember,
  useUpdateMember,
  useUpdateWorkspace,
} from '@/hooks/useWorkspaces'
import { PRODUCT_NAME } from '@/lib/brand'
import { toastApiError } from '@/lib/error-handler'
import { cn } from '@/lib/utils'
import { ROLES, type Member, type Role } from '@/types/workspace'

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Full access',
  editor: 'Can edit',
  viewer: 'Can view',
}
const ROLE_HELP: Record<Role, string> = {
  owner: 'Full access. Manages members and can delete the workspace.',
  editor: 'Can edit pages and databases.',
  viewer: 'Can read and comment, but not edit.',
}

function RoleMenu({
  value,
  onChange,
  disabled,
  label,
}: {
  value: Role
  onChange: (role: Role) => void
  disabled?: boolean
  label: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          className="hover:bg-hover data-[state=open]:bg-hover flex h-7 items-center gap-1 rounded-[4px] px-2 text-[14px] transition-colors duration-100 disabled:cursor-default disabled:opacity-100 disabled:hover:bg-transparent"
        >
          {ROLE_LABEL[value]}
          {!disabled && <ChevronDown className="text-subtle size-3.5" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[280px]">
        {ROLES.map(role => (
          <DropdownMenuItem
            key={role}
            onSelect={() => onChange(role)}
            className="items-start py-1.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{ROLE_LABEL[role]}</span>
              <span className="text-subtle block text-[12px] leading-snug">{ROLE_HELP[role]}</span>
            </span>
            {role === value && <Check className="mt-0.5 !text-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 border-b pb-2 text-[16px] font-semibold">{children}</h3>
}

function AccountTab() {
  const { data: me } = useCurrentUser()
  const update = useUpdateCurrentUser()
  const { logout } = useAuth()
  const { closeSettings } = useAppShell()
  const [draft, setDraft] = useState<string | null>(null)

  if (!me) return <p className="text-muted-foreground text-[14px]">Loading…</p>
  const value = draft ?? me.display_name

  const save = async () => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (next === me.display_name) return
    try {
      await update.mutateAsync({ display_name: next })
      toast.success('Name updated')
    } catch (error) {
      toastApiError(error, 'Could not update your name')
    }
  }

  return (
    <div>
      <SectionTitle>My account</SectionTitle>
      <div className="flex items-center gap-4">
        <Avatar name={displayNameOf(me)} seed={me.id} size={64} />
        <div className="min-w-0 flex-1">
          <label
            htmlFor="settings-display-name"
            className="text-muted-foreground text-[12px] font-medium"
          >
            Preferred name
          </label>
          <Input
            id="settings-display-name"
            className="mt-1.5 max-w-[320px]"
            value={value}
            maxLength={100}
            placeholder={me.email.split('@')[0]}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={event => event.key === 'Enter' && void save()}
          />
        </div>
      </div>
      <div className="mt-6">
        <div className="text-[14px] font-medium">Email</div>
        <div className="text-muted-foreground mt-0.5 text-[14px]">{me.email}</div>
      </div>
      <div className="mt-8 border-t pt-4">
        <Button
          variant="outline"
          onClick={() => {
            closeSettings()
            void logout()
          }}
        >
          <LogOut />
          Log out
        </Button>
      </div>
    </div>
  )
}

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
  { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
]

/** A tiny picture of the app in the theme it selects. */
function ThemePreview({ value }: { value: Theme }) {
  const dark = value === 'dark'
  const half = value === 'system'
  const pane = (isDark: boolean) => (
    <div className={cn('flex h-full flex-1 gap-1.5 p-2', isDark ? 'bg-[#191919]' : 'bg-white')}>
      <div className={cn('h-full w-1/4 rounded-[2px]', isDark ? 'bg-[#202020]' : 'bg-[#f7f7f5]')} />
      <div className="flex-1 space-y-1.5 pt-1">
        <div className={cn('h-1.5 w-2/3 rounded-full', isDark ? 'bg-white/60' : 'bg-black/60')} />
        <div className={cn('h-1 w-full rounded-full', isDark ? 'bg-white/20' : 'bg-black/15')} />
        <div className={cn('h-1 w-5/6 rounded-full', isDark ? 'bg-white/20' : 'bg-black/15')} />
      </div>
    </div>
  )
  return (
    <div className="flex h-[72px] overflow-hidden rounded-t-[5px] border-b">
      {half ? (
        <>
          {pane(false)}
          {pane(true)}
        </>
      ) : (
        pane(dark)
      )}
    </div>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>
      <div className="mb-3 text-[14px] font-medium">Theme</div>
      <p className="text-muted-foreground mb-4 text-[13px]">
        Choose how {PRODUCT_NAME} looks. Press Ctrl/Cmd+Shift+L to switch between light and dark.
      </p>
      <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-3">
        {THEME_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={theme === option.value}
            aria-label={option.label}
            onClick={() => setTheme(option.value)}
            className={cn(
              'w-[150px] overflow-hidden rounded-[6px] text-left transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              theme === option.value
                ? 'shadow-[0_0_0_2px_var(--primary)]'
                : 'shadow-[0_0_0_1px_var(--border)] hover:shadow-[0_0_0_1px_var(--pressed)]'
            )}
          >
            <ThemePreview value={option.value} />
            <span className="flex items-center gap-1.5 px-2.5 py-2 text-[13px] font-medium">
              {option.icon}
              {option.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function WorkspaceTab() {
  const { workspace, isOwner, workspaces, setWorkspaceId } = useWorkspace()
  const update = useUpdateWorkspace(workspace.id)
  const remove = useDeleteWorkspace()
  const navigate = useNavigate()
  const { closeSettings } = useAppShell()
  const [name, setName] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  const saveName = async () => {
    if (name === null) return
    const next = name.trim()
    setName(null)
    if (!next || next === workspace.name) return
    try {
      await update.mutateAsync({ name: next })
    } catch (error) {
      toastApiError(error, 'Could not rename the workspace')
    }
  }

  const saveIcon = async (icon: string | null) => {
    setPickerOpen(false)
    try {
      await update.mutateAsync({ icon })
    } catch (error) {
      toastApiError(error, 'Could not change the icon')
    }
  }

  const deleteWorkspace = async () => {
    try {
      await remove.mutateAsync(workspace.id)
      setConfirming(false)
      setTyped('')
      closeSettings()
      const next = workspaces.find(item => item.id !== workspace.id)
      if (next) setWorkspaceId(next.id)
      await navigate({ to: '/home' })
      toast.success('Workspace deleted')
    } catch (error) {
      toastApiError(error, 'Could not delete the workspace')
    }
  }

  return (
    <div>
      <SectionTitle>Workspace</SectionTitle>
      <div className="flex items-end gap-4">
        <div>
          <div className="text-muted-foreground mb-1.5 text-[12px] font-medium">Icon</div>
          {/* The picker renders inline, not in a popover: the modal dialog owns
              pointer events while open, so a body-portal popover cannot be
              clicked (Radix modal-dialog behaviour). */}
          <button
            type="button"
            aria-label="Change workspace icon"
            aria-expanded={pickerOpen}
            disabled={!isOwner}
            onClick={() => setPickerOpen(open => !open)}
            className="hover:bg-hover grid size-16 place-items-center rounded-[6px] shadow-[inset_0_0_0_1px_var(--input-ring)] transition-colors duration-100 disabled:hover:bg-transparent"
          >
            <WorkspaceIcon name={workspace.name} icon={workspace.icon} size={40} />
          </button>
          {pickerOpen && (
            <div className="shadow-menu bg-popover mt-2 w-[342px] rounded-[6px] p-1">
              <EmojiPicker
                onSelect={emoji => void saveIcon(emoji)}
                onRemove={workspace.icon ? () => void saveIcon(null) : undefined}
              />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <label
            htmlFor="settings-workspace-name"
            className="text-muted-foreground text-[12px] font-medium"
          >
            Workspace name
          </label>
          <Input
            id="settings-workspace-name"
            className="mt-1.5 max-w-[360px]"
            value={name ?? workspace.name}
            maxLength={100}
            disabled={!isOwner}
            onChange={event => setName(event.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={event => event.key === 'Enter' && void saveName()}
          />
        </div>
      </div>
      {!isOwner && (
        <p className="text-muted-foreground mt-3 text-[13px]">
          Only the owner can change these settings.
        </p>
      )}

      {isOwner && (
        <div className="mt-10 border-t pt-4">
          <div className="text-[14px] font-medium">Delete workspace</div>
          <p className="text-muted-foreground mt-1 text-[13px]">
            This deletes every page and comment in the workspace. It cannot be undone.
          </p>
          <Button
            variant="outline"
            className="text-destructive mt-3"
            onClick={() => setConfirming(true)}
          >
            Delete entire workspace
          </Button>
        </div>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={next => {
          setConfirming(next)
          if (!next) setTyped('')
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              Type <strong>{workspace.name}</strong> to confirm. All pages and members are removed
              forever.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Type the workspace name to confirm"
            value={typed}
            onChange={event => setTyped(event.target.value)}
            placeholder={workspace.name}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={typed !== workspace.name || remove.isPending}
              onClick={event => {
                event.preventDefault()
                void deleteWorkspace()
              }}
            >
              Delete workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function MemberRow({
  member,
  canManage,
  isMe,
}: {
  member: Member
  canManage: boolean
  isMe: boolean
}) {
  const { workspace } = useWorkspace()
  const updateMember = useUpdateMember(workspace.id)
  const removeMember = useRemoveMember(workspace.id)
  const { closeSettings } = useAppShell()
  const navigate = useNavigate()
  const name = displayNameOf(member)

  const changeRole = async (role: Role) => {
    if (role === member.role) return
    try {
      await updateMember.mutateAsync({ userId: member.user_id, role })
    } catch (error) {
      toastApiError(error, 'Could not change the role')
    }
  }

  const remove = async () => {
    try {
      await removeMember.mutateAsync(member.user_id)
      if (isMe) {
        closeSettings()
        await navigate({ to: '/home' })
        toast.success(`You left ${workspace.name}`)
      }
    } catch (error) {
      toastApiError(error, isMe ? 'Could not leave the workspace' : 'Could not remove the member')
    }
  }

  return (
    <li className="flex items-center gap-3 py-2" data-testid="member-row">
      <Avatar name={name} seed={member.user_id} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">
          {name}
          {isMe && <span className="text-subtle ml-1.5 font-normal">(you)</span>}
        </div>
        <div className="text-muted-foreground truncate text-[12px]">{member.email}</div>
      </div>
      <RoleMenu
        value={member.role}
        onChange={role => void changeRole(role)}
        disabled={!canManage}
        label={`Role of ${name}`}
      />
      {(canManage && !isMe) || isMe ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void remove()}
          aria-label={isMe ? 'Leave workspace' : `Remove ${name}`}
        >
          {isMe ? 'Leave' : 'Remove'}
        </Button>
      ) : (
        <span className="w-[62px]" />
      )}
    </li>
  )
}

function MembersTab() {
  const { workspace, isOwner } = useWorkspace()
  const { data: me } = useCurrentUser()
  const { data: members = [], isLoading } = useMembers(workspace.id)
  const addMember = useAddMember(workspace.id)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')

  const invite = async (event: React.FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (!address) return
    try {
      await addMember.mutateAsync({ email: address, role })
      setEmail('')
      toast.success(`Added ${address}`)
    } catch (error) {
      toastApiError(error, 'Could not add the member')
    }
  }

  return (
    <div>
      <SectionTitle>Members</SectionTitle>
      {isOwner && (
        <form onSubmit={invite} className="mb-5 flex items-center gap-2">
          <Input
            type="email"
            aria-label="Email address"
            placeholder="Invite by email address"
            value={email}
            onChange={event => setEmail(event.target.value)}
            className="max-w-[320px]"
          />
          <RoleMenu value={role} onChange={setRole} label="Role for the new member" />
          <Button type="submit" disabled={!email.trim() || addMember.isPending}>
            Invite
          </Button>
        </form>
      )}
      <ul aria-label="Members" className="divide-border divide-y">
        {members.map(member => (
          <MemberRow
            key={member.user_id}
            member={member}
            canManage={isOwner}
            isMe={member.user_id === me?.id}
          />
        ))}
      </ul>
      {isLoading && <p className="text-muted-foreground text-[14px]">Loading…</p>}
    </div>
  )
}

const TABS: {
  id: SettingsTab
  label: string
  icon: React.ReactNode
  group: 'account' | 'workspace'
}[] = [
  { id: 'account', label: 'My account', icon: <Settings />, group: 'account' },
  { id: 'appearance', label: 'Appearance', icon: <Palette />, group: 'account' },
  { id: 'workspace', label: 'Workspace', icon: <Settings />, group: 'workspace' },
  { id: 'members', label: 'Members', icon: <Users />, group: 'workspace' },
]

/** The settings modal: My account, Appearance, Workspace and Members. */
export function SettingsDialog() {
  const { settingsTab, openSettings, closeSettings } = useAppShell()
  const { workspace } = useWorkspace()
  const { data: me } = useCurrentUser()
  const tab = settingsTab ?? 'account'

  return (
    <Dialog open={settingsTab !== null} onOpenChange={open => !open && closeSettings()}>
      <DialogContent
        showCloseButton
        aria-describedby={undefined}
        className="flex h-[min(715px,calc(100vh-100px))] w-[min(1150px,calc(100vw-100px))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Account, appearance, workspace and members.
        </DialogDescription>
        <nav
          aria-label="Settings sections"
          className="bg-sidebar w-[240px] shrink-0 overflow-y-auto border-r p-2"
        >
          <div className="text-subtle px-2 pt-2 pb-1 text-[12px] font-medium">Account</div>
          <div className="text-muted-foreground mb-2 truncate px-2 pb-2 text-[13px]">
            {me?.email}
          </div>
          {(['account', 'workspace'] as const).map(group => (
            <div key={group} className="mb-2">
              {group === 'workspace' && (
                <div className="text-subtle truncate px-2 pt-2 pb-1 text-[12px] font-medium">
                  {workspace.name}
                </div>
              )}
              {TABS.filter(item => item.group === group).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openSettings(item.id)}
                  aria-current={tab === item.id ? 'page' : undefined}
                  className={cn(
                    'text-muted-foreground flex h-[28px] w-full items-center gap-2 rounded-[4px] px-2 text-left text-[14px] font-medium transition-colors duration-100 [&_svg]:size-[18px]',
                    tab === item.id ? 'bg-hover-strong text-foreground' : 'hover:bg-hover'
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="nx-scroll min-w-0 flex-1 overflow-y-auto px-10 py-8">
          <div className="max-w-[720px]">
            {tab === 'account' && <AccountTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'workspace' && <WorkspaceTab />}
            {tab === 'members' && <MembersTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
