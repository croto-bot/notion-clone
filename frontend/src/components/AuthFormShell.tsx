import { Link } from '@tanstack/react-router'
import { NotionLogo } from '@/components/NotionLogo'
import { PRODUCT_NAME } from '@/lib/brand'

interface AuthFormShellProps {
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
}

/** The centered sign-in layout: logo on top, a 380 px column below. */
export function AuthFormShell({ title, description, children, footer }: AuthFormShellProps) {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="flex h-[60px] items-center px-5">
        <Link
          to="/"
          aria-label={`${PRODUCT_NAME} home`}
          className="hover:bg-hover flex items-center gap-2 rounded-[4px] px-1.5 py-1 transition-colors duration-100"
        >
          <NotionLogo size={26} />
          <span className="text-[17px] font-bold tracking-tight">{PRODUCT_NAME}</span>
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center px-6 pt-[8vh] pb-16">
        <div className="w-full max-w-[380px]">
          <h1 className="text-center text-[34px] leading-[1.15] font-bold tracking-[-0.02em]">
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground mt-3 text-center text-[15px] leading-snug">
              {description}
            </p>
          ) : null}
          <div className="mt-8">{children}</div>
          {footer}
        </div>
      </main>
    </div>
  )
}
