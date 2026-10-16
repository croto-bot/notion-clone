import { type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

interface AuthFieldProps<T extends FieldValues> {
  control: Control<T>
  name: FieldPath<T>
  disabled: boolean
}

export function NameField<T extends FieldValues>({ control, name, disabled }: AuthFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Name</FormLabel>
          <FormControl>
            <Input
              className="h-10 text-[15px]"
              autoComplete="name"
              placeholder="Your name (optional)"
              {...field}
              value={field.value ?? ''}
              disabled={disabled}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function EmailField<T extends FieldValues>({ control, name, disabled }: AuthFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Email</FormLabel>
          <FormControl>
            <Input
              className="h-10 text-[15px]"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              {...field}
              disabled={disabled}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

interface PasswordFieldProps<T extends FieldValues> extends AuthFieldProps<T> {
  label?: string
  autoComplete?: string
}

export function PasswordField<T extends FieldValues>({
  control,
  name,
  disabled,
  label = 'Password',
  autoComplete = 'current-password',
}: PasswordFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              className="h-10 text-[15px]"
              type="password"
              autoComplete={autoComplete}
              placeholder="••••••••"
              {...field}
              disabled={disabled}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
