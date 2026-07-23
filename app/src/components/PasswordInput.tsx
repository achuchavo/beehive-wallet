import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  /**
   * Visible label. Optional so existing call sites keep working, but preferred
   * over a placeholder alone: a placeholder disappears as soon as the field has
   * a value, which on a signing password is exactly when you want to be sure
   * what you are typing into.
   */
  label?: string
}

// Password field with a show/hide eye toggle.
export default function PasswordInput({ className = '', label, ...props }: Props) {
  const { t } = useT()
  const [show, setShow] = useState(false)
  const id = useId()
  return (
    <div className="relative">
      {label && (
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
          {label}
        </label>
      )}
      <input
        id={label ? id : undefined}
        {...props}
        type={show ? 'text' : 'password'}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('common.hidePassword') : t('common.showPassword')}
        className={`absolute right-2 text-slate-500 hover:text-slate-600 ${
          label ? 'bottom-2.5' : 'top-1/2 -translate-y-1/2'
        }`}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
