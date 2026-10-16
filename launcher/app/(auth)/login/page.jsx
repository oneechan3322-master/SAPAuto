import { redirect } from 'next/navigation'
import { pageSession, pageSetupRequired } from '../../../lib/guard.js'
import LoginForm from '../../../components/login-form.jsx'

export default async function LoginPage() {
  if (pageSetupRequired()) redirect('/setup')
  const session = await pageSession()
  if (session?.user && !session.user.disabled) redirect('/')
  return <LoginForm />
}
