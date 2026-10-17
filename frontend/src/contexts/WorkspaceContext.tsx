import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NotionLogo } from '@/components/NotionLogo'
import { useCurrentUser, displayNameOf } from '@/hooks/useUser'
import { useCreateWorkspace, useWorkspaces } from '@/hooks/useWorkspaces'
import { getErrorMessage, toastApiError } from '@/lib/error-handler'
import type { Role, Workspace } from '@/types/workspace'

/** localStorage key of the workspace shown last. */
export const WORKSPACE_KEY = 'nx-workspace'

/** Where the first-workspace bootstrap stands: one attempt at a time, never a silent loop. */
type BootstrapPhase = 'idle' | 'creating' | 'done' | 'failed'

interface WorkspaceContextValue {
  workspaces: Workspace[]
  /** The workspace on screen. */
  workspace: Workspace
  setWorkspaceId: (id: string) => void
  role: Role
  isOwner: boolean
  /** Owners and editors can change pages; viewers only read (and comment). */
  canEdit: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined)

function readStoredWorkspaceId(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY)
  } catch {
    return null
  }
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-muted-foreground flex min-h-screen flex-col items-center justify-center gap-4">
      {children}
    </div>
  )
}

/**
 * Loads my workspaces and picks the one on screen. A user who has none (a new
 * account) gets "<name>'s Notion" created here, as the first thing after sign-in.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data: workspaces, isError, error, refetch } = useWorkspaces()
  const { data: me } = useCurrentUser()
  const createWorkspace = useCreateWorkspace()
  const [selectedId, setSelectedId] = useState<string | null>(readStoredWorkspaceId)
  const [bootstrap, setBootstrap] = useState<BootstrapPhase>('idle')
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaces || workspaces.length > 0 || !me || bootstrap !== 'idle') return
    // Exactly one attempt per 'idle': a failed create stops here (the Try
    // again button below re-arms it) instead of retrying on every re-render.
    setBootstrap('creating')
    createWorkspace.mutate(
      { name: `${displayNameOf(me)}'s Notion`.slice(0, 100) },
      {
        onSuccess: workspace => {
          setBootstrap('done')
          setSelectedId(workspace.id)
        },
        onError: err => {
          setBootstrapError(getErrorMessage(err))
          setBootstrap('failed')
          toastApiError(err, 'Could not create your workspace')
        },
      }
    )
  }, [workspaces, me, createWorkspace, bootstrap])

  const workspace = workspaces?.find(item => item.id === selectedId) ?? workspaces?.[0]
  const currentId = workspace?.id

  useEffect(() => {
    if (!currentId) return
    try {
      localStorage.setItem(WORKSPACE_KEY, currentId)
    } catch {
      // Private mode: the choice lasts until the tab closes.
    }
  }, [currentId])

  const value = useMemo<WorkspaceContextValue | null>(() => {
    if (!workspaces || !workspace) return null
    return {
      workspaces,
      workspace,
      setWorkspaceId: setSelectedId,
      role: workspace.role,
      isOwner: workspace.role === 'owner',
      canEdit: workspace.role !== 'viewer',
    }
  }, [workspaces, workspace])

  if (isError) {
    return (
      <FullScreenMessage>
        <p className="text-foreground text-[16px] font-medium">Could not load your workspaces</p>
        <p className="text-[14px]">{getErrorMessage(error)}</p>
        <Button onClick={() => void refetch()}>Try again</Button>
      </FullScreenMessage>
    )
  }

  if (bootstrap === 'failed') {
    return (
      <FullScreenMessage>
        <p className="text-foreground text-[16px] font-medium">Could not create your workspace</p>
        <p className="text-[14px]">{bootstrapError}</p>
        <Button
          onClick={() => {
            setBootstrapError(null)
            setBootstrap('idle')
          }}
        >
          Try again
        </Button>
      </FullScreenMessage>
    )
  }

  if (!value) {
    return (
      <FullScreenMessage>
        <NotionLogo size={44} className="text-foreground animate-pulse" />
        <span className="sr-only" role="status">
          Loading your workspace
        </span>
      </FullScreenMessage>
    )
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (context === undefined) throw new Error('useWorkspace must be used within a WorkspaceProvider')
  return context
}
