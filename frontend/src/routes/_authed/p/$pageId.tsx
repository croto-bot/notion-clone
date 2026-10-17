import { createFileRoute } from '@tanstack/react-router'
import { PageView } from '@/components/PageView'

// A page or a database of the current workspace. The key remounts everything
// (editor, socket, comments) when the page changes.
export const Route = createFileRoute('/_authed/p/$pageId')({
  component: PageRoute,
})

function PageRoute() {
  const { pageId } = Route.useParams()
  return <PageView key={pageId} pageId={pageId} />
}
