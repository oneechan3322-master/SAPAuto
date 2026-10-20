import { Cairo, IBM_Plex_Sans_Arabic } from 'next/font/google'
import './globals.css'
import './kamal/kamal-mode.css'
import PwaRegister from '../components/pwa-register.jsx'

const plex = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-plex'
})

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-cairo'
})

export const metadata = {
  title: 'SAPAuto — مكتب اليوم',
  description: 'لوحة تشغيل المكتب الذكية',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'SAPAuto V8' }
}

/** Applies the saved theme before first paint so the page never flashes. */
const themeBoot = `try{var t=localStorage.getItem('sapauto.theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;document.body.classList.remove('kamal-mode')}else{document.body.classList.add('kamal-mode')}}catch(e){}`

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl" className={`${plex.variable} ${cairo.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <PwaRegister />
        {children}
      </body>
    </html>
  )
}