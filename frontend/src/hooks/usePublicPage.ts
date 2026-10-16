import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { API } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'
import type { PublicPage } from '@/types/public-page'

/** The public page behind `/share/<publicId>`. No sign-in: the session token is ignored by the backend. */
export function usePublicPage(publicId: string) {
  return useQuery({
    queryKey: queryKeys.publicPages.detail(publicId),
    queryFn: () => api.get<PublicPage>(API.PUBLIC.PAGE(publicId)),
    retry: false,
    staleTime: 30 * 1000,
  })
}
