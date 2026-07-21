import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

type Props = React.InputHTMLAttributes<HTMLInputElement>

// Password field with a show/hide eye toggle.
export default function PasswordInput({ className = '', ...props }: Props) {
  const { t } = useT()
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        {...props}
        type={show ? 'text' : 'password'}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('common.hidePassword') : t('common.showPassword')}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
