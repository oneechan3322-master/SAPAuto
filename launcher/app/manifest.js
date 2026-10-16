export default function manifest() {
  return {
    name: 'SAPAuto V8 Mission Control',
    short_name: 'SAPAuto',
    description: 'لوحة تشغيل المكتب الذكية',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b1118',
    theme_color: '#0b1118',
    lang: 'ar',
    dir: 'rtl',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
  }
}
