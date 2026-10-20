// Deliberate open-access switch. When truthy via V8_OPEN_ACCESS=1 the launcher
// serves the workspace to callers without a session, acting as the first active
// Owner row (no fabrication of users). Unset or '0' restores strict auth.
export const OPEN_ACCESS_ENV = 'V8_OPEN_ACCESS'

export function openAccessEnabled() {
  return process.env[OPEN_ACCESS_ENV] === '1'
}

export function fallbackWorkspaceUser(db) {
  return db.prepare(`SELECT id,name,email,role FROM users
    WHERE disabled=0 AND role='Owner' LIMIT 1`).get()
}
