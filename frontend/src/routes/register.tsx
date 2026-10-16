import { createFileRoute, Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { AuthFormShell } from '@/components/AuthFormShell'
import { EmailField, NameField, PasswordField } from '@/components/AuthFormFields'
import { API } from '@/lib/api-endpoints'
import { useAuthSubmit } from '@/hooks/useAuthSubmit'
import { useHydrated } from '@/hooks/useHydrated'
import {
  registerSchema,
  registerFormToPayload,
  type RegisterFormData,
  type RegisterPayload,
} from '@/features/auth/auth-schemas'

export const Route = createFileRoute('/register')({
  component: Register,
})

function Register() {
  const hydrated = useHydrated()
  const { submit, isLoading } = useAuthSubmit<RegisterPayload>(
    API.AUTH.REGISTER,
    'Account created successfully',
    'Registration failed'
  )

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
  })

  // Inert until hydrated, and while the request runs.
  const disabled = isLoading || !hydrated

  const onSubmit = (data: RegisterFormData) => submit(registerFormToPayload(data))

  return (
    <AuthFormShell
      title="Create your account"
      description="Your workspace is ready in a few seconds."
      footer={
        <p className="text-muted-foreground mt-6 text-center text-[14px]">
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-primary underline-offset-2 transition-colors duration-100 hover:underline"
          >
            Log in
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
          <NameField control={form.control} name="displayName" disabled={disabled} />
          <EmailField control={form.control} name="email" disabled={disabled} />
          <PasswordField
            control={form.control}
            name="password"
            disabled={disabled}
            autoComplete="new-password"
          />
          <PasswordField
            control={form.control}
            name="confirmPassword"
            disabled={disabled}
            label="Confirm Password"
            autoComplete="new-password"
          />
          <Button type="submit" size="lg" className="mt-2 w-full" disabled={disabled}>
            {isLoading ? 'Creating account...' : 'Create account'}
          </Button>
        </form>
      </Form>
    </AuthFormShell>
  )
}
