import { redirect } from 'next/navigation'
import { pageSession, pageSetupRequired } from '../../../lib/guard.js'
import SetupForm from '../../../components/setup-form.jsx'

export default async function SetupPage() {
  if (!pageSetupRequired()) {
    const session = await pageSession()
    redirect(session?.user ? '/' : '/login')
  }
  return <SetupForm />
}
