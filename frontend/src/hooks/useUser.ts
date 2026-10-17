import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api-client'
import { API } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'
import type { CurrentUser, UpdateCurrentUserData } from '@/types/user'

export function useCurrentUser() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: queryKeys.user.me,
    queryFn: () => api.get<CurrentUser>(API.USERS.ME),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateCurrentUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateCurrentUserData) => api.patch<CurrentUser>(API.USERS.ME, data),
    onSuccess: user => {
      queryClient.setQueryData(queryKeys.user.me, user)
      // The name shows in member lists, comments and page authors.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.all })
    },
  })
}

/** The name Notion shows for a user: the display name, or the part of the email before the `@`. */
export function displayNameOf(user: { display_name?: string | null; email: string }): string {
  const name = user.display_name?.trim()
  return name ? name : user.email.split('@')[0]
}
