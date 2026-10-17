import { useEffect } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Check, ChevronRight, FileText, Home, Search, Settings, Star } from 'lucide-react'
import { NotionLogo } from '@/components/NotionLogo'
import { buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { PRODUCT_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  // The server cannot read the session (it is in localStorage): after hydration,
  // a signed-in visitor goes straight to the app.
  useEffect(() => {
    if (isAuthenticated) void navigate({ to: '/home', replace: true })
  }, [isAuthenticated, navigate])

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="bg-background/90 sticky top-0 z-30 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2" aria-label={`${PRODUCT_NAME} home`}>
            <NotionLogo size={30} />
            <span className="text-[20px] font-bold tracking-tight">{PRODUCT_NAME}</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className={cn(buttonVariants({ variant: 'ghost', size: 'default' }), 'text-[15px]')}
            >
              Log in
            </Link>
            <Link
              to="/register"
              className={cn(buttonVariants({ variant: 'default', size: 'default' }), 'text-[15px]')}
            >
              Get {PRODUCT_NAME} free
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-[1120px] px-6 pt-16 pb-10 text-center sm:pt-24">
          <h1 className="animate-in fade-in-0 slide-in-from-bottom-2 mx-auto max-w-[760px] text-[44px] leading-[1.05] font-bold tracking-[-0.035em] duration-500 sm:text-[64px]">
            Write. Plan. <span className="text-primary">Collaborate.</span>
          </h1>
          <p className="text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-2 mx-auto mt-6 max-w-[560px] text-[18px] leading-snug delay-100 duration-500 sm:text-[20px]">
            {PRODUCT_NAME} is an open-source Notion alternative: docs, wikis and databases, edited
            together in real time.
          </p>
          <div className="animate-in fade-in-0 mt-9 flex flex-wrap items-center justify-center gap-3 delay-200 duration-500">
            <Link
              to="/register"
              className={cn(
                buttonVariants({ variant: 'default', size: 'lg' }),
                'h-11 px-5 text-[16px]'
              )}
            >
              Get {PRODUCT_NAME} free
            </Link>
            <Link
              to="/login"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'h-11 px-5 text-[16px]'
              )}
            >
              Log in
            </Link>
          </div>
        </section>

        <section aria-hidden="true" className="mx-auto max-w-[1040px] px-6 pb-20">
          <AppMock />
        </section>

        <section className="bg-sidebar border-y">
          <div className="mx-auto grid max-w-[1120px] gap-8 px-6 py-16 sm:grid-cols-3">
            <Feature
              title="Docs that feel like a doc"
              text="Type / for blocks, drag them around, link pages together. Headings, lists, to-dos, toggles, code, tables and more."
            />
            <Feature
              title="Real-time collaboration"
              text="See who is on the page, follow live cursors and keep editing while offline. Changes merge when you reconnect."
            />
            <Feature
              title="Databases in four views"
              text="Turn any list into a table, board, list or gallery. Sort, filter and group without leaving the page."
            />
          </div>
        </section>
      </main>

      <footer className="text-muted-foreground mx-auto flex max-w-[1120px] items-center justify-between px-6 py-8 text-[13px]">
        <span>© {PRODUCT_NAME}. An open-source Notion alternative.</span>
        <span className="flex gap-4">
          <Link to="/login" className="hover:text-foreground transition-colors duration-100">
            Log in
          </Link>
          <Link to="/register" className="hover:text-foreground transition-colors duration-100">
            Sign up
          </Link>
        </span>
      </footer>
    </div>
  )
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="text-[19px] leading-tight font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">{text}</p>
    </div>
  )
}

const MOCK_ROWS = [
  { icon: <Home className="size-4" />, label: 'Home' },
  { icon: <Search className="size-4" />, label: 'Search' },
  { icon: <Settings className="size-4" />, label: 'Settings' },
]

/** A static picture of the app, built from the same colors as the real thing. */
function AppMock() {
  return (
    <div className="bg-background shadow-modal mx-auto flex h-[420px] overflow-hidden rounded-[10px] border text-left">
      <div className="bg-sidebar hidden w-[220px] shrink-0 flex-col gap-0.5 border-r p-2 sm:flex">
        <div className="mb-2 flex items-center gap-2 px-2 py-1.5 text-[14px] font-medium">
          <span className="grid size-5 place-items-center rounded-[4px] bg-[#e7f3f8] text-[11px]">
            A
          </span>
          Ada&apos;s Workspace
        </div>
        {MOCK_ROWS.map(row => (
          <div
            key={row.label}
            className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-[14px]"
          >
            {row.icon}
            {row.label}
          </div>
        ))}
        <div className="text-subtle mt-4 px-2 py-1 text-[12px] font-medium">Favorites</div>
        <div className="flex items-center gap-2 px-2 py-1 text-[14px]">
          <Star className="text-muted-foreground size-4" />
          Product roadmap
        </div>
        <div className="text-subtle mt-3 px-2 py-1 text-[12px] font-medium">Pages</div>
        <div className="bg-hover-strong flex items-center gap-2 rounded-[4px] px-2 py-1 text-[14px] font-medium">
          <ChevronRight className="text-subtle size-3.5 rotate-90" />
          🚀 Product roadmap
        </div>
        <div className="flex items-center gap-2 py-1 pr-2 pl-7 text-[14px]">
          <FileText className="text-muted-foreground size-4" />
          Launch checklist
        </div>
        <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-[14px]">
          <ChevronRight className="text-subtle size-3.5" />
          📚 Team wiki
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="h-[110px] bg-gradient-to-r from-[#bcd9f2] via-[#d8c8f0] to-[#f5c9d9]" />
        <div className="mx-auto max-w-[620px] px-8">
          <div className="-mt-9 text-[64px] leading-none">🚀</div>
          <h2 className="mt-3 text-[38px] leading-tight font-bold tracking-tight">
            Product roadmap
          </h2>
          <p className="text-muted-foreground mt-3 text-[16px]">
            Everything the team ships this quarter, in one place.
          </p>
          <ul className="mt-4 space-y-2 text-[16px]">
            {['Real-time editing', 'Boards and tables', 'Public pages'].map((item, index) => (
              <li key={item} className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'grid size-4 place-items-center rounded-[3px]',
                    index < 2 ? 'bg-primary text-white' : 'border-foreground/40 border'
                  )}
                >
                  {index < 2 ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className={index < 2 ? 'text-muted-foreground line-through' : ''}>
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
