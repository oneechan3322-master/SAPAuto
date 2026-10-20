'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Activity, Archive, Building2, CalendarClock, ChevronsLeft, ClipboardList, CreditCard,
  FileText, LayoutDashboard, LogOut, Mail, Menu, Settings2, ShieldAlert, ScrollText, Users, X
} from 'lucide-react'
import DisplayControls from './display-controls.jsx'

const mainLinks = [
  { label: 'مكتب اليوم', href: '/', icon: LayoutDashboard },
  { label: 'الشركات', href: '/companies', icon: Building2 },
  { label: 'المهام', href: '/tasks', icon: ClipboardList },
  { label: 'الأرشيف والمهل', href: '/archive', icon: Archive },
  { label: 'الالتزامات', href: '/obligations', icon: FileText },
  { label: 'المدفوعات', href: '/payments', icon: CreditCard },
  { label: 'الرواتب', href: '/payroll', icon: Users },
  { label: 'الرسائل', href: '/messages', icon: Mail },
  { label: 'التذكيرات', href: '/reminders', icon: CalendarClock },
  { label: 'التقارير', href: '/reports', icon: Activity }
]

const settingsLinks = [
  { label: 'مركز التحكم', href: '/settings', icon: Settings2 },
  { label: 'الإخفاقات', href: '/failures', icon: ShieldAlert },
  { label: 'سجل التدقيق', href: '/audit', icon: ScrollText }
]

const mobilePrimaryLinks = [mainLinks[0], mainLinks[1], mainLinks[2], mainLinks[4]]
const mobileMoreGroups = [
  { title: 'المتابعة', items: [mainLinks[3], mainLinks[5], mainLinks[6], mainLinks[7]] },
  { title: 'الإعدادات المتقدمة', items: settingsLinks }
]

export default function Navigation() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const isActive = (href) => href === '/'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`)
  const moreActive = mobileMoreGroups.some((group) => group.items.some((item) => isActive(item.href)))

  useEffect(() => setMoreOpen(false), [pathname])
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('sapauto.sidebar.collapsed') === 'true') } catch { /* ignore */ }
  }, [])

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current
      try { localStorage.setItem('sapauto.sidebar.collapsed', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <Link className="brand" href="/" aria-label="SAPAuto — مكتب اليوم">
        <span className="brand-mark">S</span>
        <span className="brand-copy"><strong>SAPAuto</strong><small>مكتبك الخاص</small></span>
      </Link>
      <button className="sidebar-collapse-button" type="button" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <ChevronsLeft size={18} aria-hidden="true" />
      </button>
      <div className="sidebar-navigation">
      <div className="nav-caption">مساحة العمل</div>
      <nav className="side-nav" aria-label="التنقل الرئيسي">
        {mainLinks.map((item) => <NavItem key={item.href} item={item} active={isActive(item.href)} />)}
      </nav>
      <div className="nav-caption nav-caption-settings">الإدارة</div>
      <nav className="side-nav" aria-label="الإعدادات والسجلات">
        {settingsLinks.map((item) => <NavItem key={item.href} item={item} active={isActive(item.href)} />)}
      </nav>
      </div>
      <nav className="mobile-bottom-nav" aria-label="التنقل">
        {mobilePrimaryLinks.map((item) => <NavItem key={item.href} item={item} active={isActive(item.href)} />)}
        <button
          className={`mobile-more-button ${moreActive ? 'active' : ''}`}
          type="button"
          aria-expanded={moreOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMoreOpen((open) => !open)}
        >
          {moreOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          <span>المزيد</span>
        </button>
      </nav>
      <div id="mobile-more-menu" className={`mobile-more-menu ${moreOpen ? 'is-open' : ''}`} hidden={!moreOpen}>
        {mobileMoreGroups.map((group) => (
          <section className="mobile-more-group" key={group.title}>
            <h2>{group.title}</h2>
            <nav aria-label={group.title}>
              {group.items.map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  onNavigate={() => setMoreOpen(false)}
                />
              ))}
            </nav>
          </section>
        ))}
      </div>
      <div className="sidebar-footer">
        <span className="local-status-dot" />
        <div><strong>مساحتك الخاصة</strong><small>معلوماتك تبقى على جهازك</small></div>
      </div>
      <DisplayControls />
    </aside>
  )
}


function NavItem({ item, active, onNavigate }) {
  const Icon = item.icon
  return (
    <Link className={`side-link ${active ? 'active' : ''}`} href={item.href} aria-label={item.label} title={item.label} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      <span>{item.label}</span>
      {active && <i className="nav-active-mark" />}
    </Link>
  )
}

function LogoutButton() {
  const [error, setError] = useState('')

  async function logout() {
    setError('')
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' })
      if (!response.ok) throw new Error('تعذر إنهاء الجلسة. أعد المحاولة.')
      window.location.assign('/login')
    } catch (caught) {
      setError(caught.message || 'تعذر إنهاء الجلسة. أعد المحاولة.')
    }
  }

  return (
    <>
      <button className="side-link logout-button" type="button" onClick={logout}>
        <LogOut size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>تسجيل الخروج</span>
      </button>
      {error && <p className="logout-error" role="alert">{error}</p>}
    </>
  )
}
