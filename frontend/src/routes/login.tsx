import { createFileRoute, Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { AuthFormShell } from '@/components/AuthFormShell'
import { EmailField, PasswordField } from '@/components/AuthFormFields'
import { API } from '@/lib/api-endpoints'
import { useAuthSubmit } from '@/hooks/useAuthSubmit'
import { useHydrated } from '@/hooks/useHydrated'
import { loginSchema, type LoginFormData } from '@/features/auth/auth-schemas'

/** Only an in-app path ('/p/…'), never a URL or '//host': anything else goes to /home after sign-in. */
function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return undefined
  return value.includes('\\') ? undefined : value
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search['redirect']),
  }),
  component: Login,
})

function Login() {
  const { redirect: redirectTo } = Route.useSearch()
  const hydrated = useHydrated()
  const { submit, isLoading } = useAuthSubmit<LoginFormData>(
    API.AUTH.LOGIN,
    'Signed in successfully',
    'Login failed',
    { to: (redirectTo ?? '/home') as '/home' }
  )

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  // Inert until hydrated, and while the request runs.
  const disabled = isLoading || !hydrated

  const onSubmit = (data: LoginFormData) => submit(data)

  return (
    <AuthFormShell
      title="Log in"
      description="Enter your email and password to open your workspace."
      footer={
        <p className="text-muted-foreground mt-6 text-center text-[14px]">
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            className="text-primary underline-offset-2 transition-colors duration-100 hover:underline"
          >
            Sign up
          </Link>
        </p>
      }
    >
      <Form {...form}>
        {/* noValidate: the zod schema validates, so its messages show instead of the browser's. */}
        <form
          method="post"
          action="#"
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <EmailField control={form.control} name="email" disabled={disabled} />
          <PasswordField control={form.control} name="password" disabled={disabled} />
          <Button type="submit" size="lg" className="mt-2 w-full" disabled={disabled}>
            {isLoading ? 'Signing in...' : 'Continue'}
          </Button>
        </form>
      </Form>
    </AuthFormShell>
  )
}
