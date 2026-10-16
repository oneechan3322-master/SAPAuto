export async function POST() {
  return Response.json({ error: 'User management is disabled.' }, { status: 410 })
}

export async function PATCH() {
  return Response.json({ error: 'User management is disabled.' }, { status: 410 })
}
