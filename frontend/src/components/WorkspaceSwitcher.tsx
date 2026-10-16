import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, LogOut, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { WorkspaceIcon } from '@/components/WorkspaceIcon'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useCreateWorkspace } from '@/hooks/useWorkspaces'
import { useCurrentUser } from '@/hooks/useUser'
import { toastApiError } from '@/lib/error-handler'
import { cn } from '@/lib/utils'

const itemClass =
  'flex min-h-[30px] w-full items-center gap-2.5 rounded-[4px] px-2 py-1 text-left text-[14px] transition-colors duration-75 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none'

function NewWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const createWorkspace = useCreateWorkspace()
  const { setWorkspaceId } = useWorkspace()
  const navigate = useNavigate()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const workspace = await createWorkspace.mutateAsync({ name: trimmed })
      setWorkspaceId(workspace.id)
      onOpenChange(false)
      setName('')
      await navigate({ to: '/home' })
    } catch (error) {
      toastApiError(error, 'Could not create the workspace')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>A workspace holds its own pages and members.</DialogDescription>
          </DialogHeader>
          <Input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to type this name
            autoFocus
            aria-label="Workspace name"
            placeholder="Workspace name"
            maxLength={100}
            value={name}
            onChange={event => setName(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || createWorkspace.isPending}>
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The top-left control of the sidebar: current workspace, the list of mine, new workspace, log out. */
export function WorkspaceSwitcher() {
  const { workspace, workspaces, setWorkspaceId } = useWorkspace()
  const { logout } = useAuth()
  const { data: me } = useCurrentUser()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Switch workspace"
            className="hover:bg-hover data-[state=open]:bg-hover-strong flex h-[30px] min-w-0 items-center gap-2 rounded-[4px] px-2 text-[14px] font-medium transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <WorkspaceIcon name={workspace.name} icon={workspace.icon} size={20} />
            <span className="truncate" data-testid="workspace-name">
              {workspace.name}
            </span>
            <ChevronDown className="text-subtle size-3.5 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} className="w-[300px] p-1.5">
          <div className="text-subtle truncate px-2 pt-1 pb-1.5 text-[12px] font-medium">
            {me?.email ?? 'Workspaces'}
          </div>
          <ul aria-label="Workspaces" className="max-h-[260px] overflow-y-auto">
            {workspaces.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(itemClass, item.id === workspace.id && 'bg-hover')}
                  onClick={() => {
                    setOpen(false)
                    if (item.id === workspace.id) return
                    setWorkspaceId(item.id)
                    void navigate({ to: '/home' })
                  }}
                >
                  <WorkspaceIcon name={item.name} icon={item.icon} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="text-subtle block text-[12px] capitalize">{item.role}</span>
                  </span>
                  {item.id === workspace.id && (
                    <Check className="text-foreground size-4 shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="bg-border my-1.5 h-px" />
          <button
            type="button"
            className={cn(itemClass, 'text-muted-foreground')}
            onClick={() => {
              setOpen(false)
              setCreating(true)
            }}
          >
            <Plus className="size-4 shrink-0" />
            New workspace
          </button>
          <button
            type="button"
            className={cn(itemClass, 'text-muted-foreground')}
            onClick={() => {
              setOpen(false)
              void logout()
            }}
          >
            <LogOut className="size-4 shrink-0" />
            Log out
          </button>
        </PopoverContent>
      </Popover>
      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
