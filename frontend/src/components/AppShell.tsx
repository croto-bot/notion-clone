import React from 'react'
import { MoveToDialog } from '@/components/MoveToDialog'
import { QuickFind } from '@/components/QuickFind'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Sidebar } from '@/components/Sidebar'
import { AppShellProvider } from '@/contexts/AppShellContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceEvents } from '@/hooks/useWorkspaceEvents'

function Shell({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace()
  useWorkspaceEvents(workspace.id)

  return (
    <div className="bg-background text-foreground flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      <QuickFind />
      <SettingsDialog />
      <MoveToDialog />
    </div>
  )
}

/** The signed-in layout: sidebar on the left, the page on the right, and the app-wide dialogs. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShellProvider>
      <Shell>{children}</Shell>
    </AppShellProvider>
  )
}
