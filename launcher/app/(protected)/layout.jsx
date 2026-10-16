import { redirect } from 'next/navigation'
import Navigation from '../../components/navigation.jsx'
import { pageSession, pageSetupRequired } from '../../lib/guard.js'

export default async function ProtectedLayout({ children }) {
  if (pageSetupRequired()) redirect('/setup')
  const session = await pageSession()
  if (!session?.user || session.user.disabled) redirect('/login')

  return (
    <div className="app-frame">
      <Navigation />
      <div className="workspace">
        <div className="read-only-banner" role="status">
          <span className="banner-mark">i</span>
          معلوماتك تبقى على جهازك · نطّلع على البوابة دون تغيير · لا ننفّذ رواتب أو مدفوعات
        </div>
        <main className="main">{children}</main>
      </div>
    </div>
  )
}
