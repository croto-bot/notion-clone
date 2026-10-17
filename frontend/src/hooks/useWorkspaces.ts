import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { API } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'
import type {
  AddMemberData,
  CreateWorkspaceData,
  Member,
  UpdateMemberData,
  UpdateWorkspaceData,
  Workspace,
} from '@/types/workspace'
import { useAuth } from '@/contexts/AuthContext'

export function useWorkspaces() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: queryKeys.workspaces.list,
    queryFn: () => api.get<Workspace[]>(API.WORKSPACES.LIST),
    enabled: isAuthenticated,
  })
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateWorkspaceData) => api.post<Workspace>(API.WORKSPACES.CREATE, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    },
  })
}

export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateWorkspaceData) =>
      api.patch<Workspace>(API.WORKSPACES.DETAIL(workspaceId), data),
    onSuccess: workspace => {
      queryClient.setQueryData<Workspace[]>(queryKeys.workspaces.list, old =>
        old?.map(item => (item.id === workspace.id ? workspace : item))
      )
    },
  })
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (workspaceId: string) => api.delete(API.WORKSPACES.DETAIL(workspaceId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    },
  })
}

export function useMembers(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces.members(workspaceId),
    queryFn: () => api.get<Member[]>(API.WORKSPACES.MEMBERS(workspaceId)),
    enabled,
  })
}

export function useAddMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: AddMemberData) =>
      api.post<Member>(API.WORKSPACES.MEMBERS(workspaceId), data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) })
    },
  })
}

export function useUpdateMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, ...data }: UpdateMemberData & { userId: string }) =>
      api.patch<Member>(API.WORKSPACES.MEMBER(workspaceId, userId), data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    },
  })
}

/** Removes a member, or leaves the workspace when `userId` is me. */
export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.delete(API.WORKSPACES.MEMBER(workspaceId, userId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    },
  })
}
