import KioskBoard from '../../components/kiosk-board.jsx'

export const dynamic = 'force-dynamic'

export default async function BoardPage({ searchParams }) {
  const { token = '' } = await searchParams
  return <main className="shell main"><KioskBoard token={token} /></main>
}
