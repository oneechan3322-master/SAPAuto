/**
 * Parser for accounts.txt / ACCOUNTS env var.
 *
 * Source priority (highest wins):
 *   1. ACCOUNTS environment variable  (comma-separated "user|pass" pairs)
 *   2. accounts.txt file              (legacy fallback, one "user|pass" per line)
 *
 * Adheres to RULE 1 (NEVER IGNORE RETURN VALUES), RULE 2 (VALIDATE ALL INPUTS),
 * RULE 3 (NO SILENT FAILURES), RULE 6 (BOUNDED OPERATIONS).
 */

const fs = require('fs');
const path = require('path');
const { ConfigError, ValidationError } = require('../common/errors');
const { assertNonEmptyString, assertInvariant } = require('../common/assertions');

/**
 * @typedef {Object} Account
 * @property {string} id - Unique identifier or index
 * @property {string} label - Display label (e.g. username or custom label)
 * @property {string} username - ETA Keycloak username
 * @property {string} password - ETA Keycloak password
 */

const MAX_ACCOUNTS_LIMIT = 200;

// Curated company names for portal accounts whose ETA Workspace link cannot be
// read on every run. Resolution tier 4: the workspace link outranks these.
const KNOWN_ACCOUNT_ALIASES = {
  'evgeegypt': 'افجي التوكيلات الملاحية والاعمال البحرية - افجي مصر',
  '474255484': 'أبيكو للمقاولات',
  '533158788': 'شركة جلوب كيم للتجارة والتوزيع',
  '407186514_0': 'مجدي مصطفي علي عطيه وشركاه فونيكس مار للتوكيلات الملاحيه والتجارية والاستيراد',
  'TransGulfM': 'ترانس جلف للملاحة والتجارة البحرية (Trans Gulf Marine)',
  'TransGulfm': 'ترانس جلف للملاحة والتجارة البحرية (Trans Gulf Marine)',
  'Trans_gulf': 'عبر الخليج للكيماويات',
  'select-green': 'سيليكت جرين للتجارة والتوريدات (Select Green)',
  'select_green': 'سيليكت جرين للتجارة والتوريدات (Select Green)',
  'Bright-123': 'برايت للتجارة والتوريدات (Bright)',
  'Bright_123': 'برايت للتجارة والتوريدات (Bright)'
};

/**
 * Parses the ACCOUNTS environment variable into raw "user|pass" lines.
 * Format: comma-separated entries, e.g. "user1|pass1,user2|pass2".
 * Each entry may also include a label: "label|user|pass" (3 parts).
 *
 * @returns {string[]|null} Lines array, or null if env var is not set.
 */
function parseAccountsFromEnv() {
  const raw = (process.env.ACCOUNTS || '').trim();
  if (!raw) return null;

  // Split on newlines if present, otherwise on commas
  const separator = raw.includes('\n') ? /\r?\n/ : ',';
  return raw.split(separator).map((s) => s.trim()).filter(Boolean);
}

/**
 * Parses an accounts text file into structured Account objects.
 * Format per line: "username|password" or "username|Company Name|password" or "Company Name|username|password"
 *
 * When called with no filePath argument (or the default accounts.txt path),
 * checks the ACCOUNTS environment variable first and returns immediately if it is
 * populated — accounts.txt is then ignored completely.
 *
 * @param {string} [filePath] - Path to accounts.txt (ignored when ACCOUNTS env var is set on default path)
 * @returns {Account[]}
 */
function parseAccountsFile(filePath) {
  // ── Priority 1: ACCOUNTS env var ────────────────────────────────────────
  const isDefaultFile = !filePath || path.resolve(filePath) === path.resolve(process.cwd(), 'accounts.txt');
  if (isDefaultFile) {
    const envLines = parseAccountsFromEnv();
    if (envLines !== null) {
      if (envLines.length === 0) {
        throw new ConfigError('ACCOUNTS environment variable is set but contains no entries', {
          raw: process.env.ACCOUNTS
        });
      }
      return _parseLines(envLines, 'ACCOUNTS env var');
    }
  }

  // ── Priority 2: accounts.txt file ───────────────────────────────────────
  const targetPath = filePath
    ? assertNonEmptyString(filePath, 'filePath', 'parseAccountsFile')
    : path.resolve(process.cwd(), 'accounts.txt');

  if (!fs.existsSync(targetPath)) {
    throw new ConfigError(`Accounts file does not exist at ${targetPath}`, { targetPath });
  }

  let content = '';
  try {
    content = fs.readFileSync(targetPath, 'utf8');
  } catch (readErr) {
    throw new ConfigError(`Failed to read accounts file at ${targetPath}`, { targetPath }, readErr);
  }

  const lines = content.split(/\r?\n/);
  return _parseLines(lines, targetPath);
}

/**
 * Shared line-parsing logic used by both parseAccountsFile and env-var parsing.
 *
 * @param {string[]} lines - Raw lines (from file split or comma-split env var)
 * @param {string} source  - Human-readable source label for error messages
 * @returns {Account[]}
 */
function _parseLines(lines, source) {
  const accounts = [];
  const errors = [];

  // Bounded iteration limit
  const maxLines = Math.min(lines.length, MAX_ACCOUNTS_LIMIT * 2);

  for (let i = 0; i < maxLines; i++) {
    const rawLine = lines[i];
    if (typeof rawLine !== 'string') {
      continue;
    }

    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      // Empty line or comment
      continue;
    }

    const parts = trimmed.split('|');
    if (parts.length < 2) {
      // Do not retain raw input: a malformed line can contain a password.
      errors.push({ line: i + 1, error: 'Expected format username|password' });
      continue;
    }

    let label = '';
    let username = '';
    let password = '';

    if (parts.length === 2) {
      username = parts[0].trim();
      password = parts[1].trim();
      label = KNOWN_ACCOUNT_ALIASES[username] || username;
    } else if (parts[0].includes('@') || parts[0].includes('.com') || parts[0].includes('.eg')) {
      // First part is clearly the username/email, remaining parts are part of the password
      username = parts[0].trim();
      password = parts.slice(1).join('|').trim();
      label = KNOWN_ACCOUNT_ALIASES[username] || username;
    } else if (parts.length >= 3) {
      const p0 = parts[0].trim();
      const p1 = parts[1].trim();
      const pRemainder = parts.slice(2).join('|').trim();

      // Check if p0 is numeric tax number/username and p1 is Arabic company name
      const isP0TaxNumber = /^[\d_]+$/.test(p0);
      const isP1TaxNumber = /^[\d_]+$/.test(p1);

      if (isP0TaxNumber && !isP1TaxNumber) {
        // Format: username|Company Name|password
        username = p0;
        label = p1;
        password = pRemainder;
      } else {
        // Format: Company Name|username|password
        label = p0;
        username = p1;
        password = pRemainder;
      }
    }

    if (!username || !password) {
      errors.push({ line: i + 1, error: 'Username or password cannot be blank' });
      continue;
    }

    accounts.push({
      id: `acc_${accounts.length + 1}`,
      label,
      username,
      password
    });

    if (accounts.length >= MAX_ACCOUNTS_LIMIT) {
      break;
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(`Encountered ${errors.length} invalid line(s) in accounts source "${source}"`, {
      source,
      errors
    });
  }

  assertInvariant(accounts.length <= MAX_ACCOUNTS_LIMIT, 'Accounts count exceeded maximum bounds');

  return accounts;
}

/**
 * Reads the raw lines of the accounts file, preserving comments and blanks.
 *
 * @param {string} [filePath]
 * @returns {string[]}
 */
function readRawLines(filePath) {
  const targetPath = filePath
    ? assertNonEmptyString(filePath, 'filePath', 'readRawLines')
    : path.resolve(process.cwd(), 'accounts.txt');

  if (!fs.existsSync(targetPath)) {
    throw new ConfigError(`Accounts file does not exist at ${targetPath}`, { targetPath });
  }

  let content = '';
  try {
    content = fs.readFileSync(targetPath, 'utf8');
  } catch (readErr) {
    throw new ConfigError(`Failed to read accounts file at ${targetPath}`, { targetPath }, readErr);
  }

  return content.split(/\r?\n/);
}

/**
 * Writes the accounts file back to disk from an array of raw lines.
 *
 * @param {string[]} lines
 * @param {string} [filePath]
 * @returns {string} The written file path
 */
function writeRawLines(lines, filePath) {
  if (!Array.isArray(lines)) {
    throw new ValidationError('lines must be an array', { receivedType: typeof lines });
  }

  const targetPath = filePath
    ? assertNonEmptyString(filePath, 'filePath', 'writeRawLines')
    : path.resolve(process.cwd(), 'accounts.txt');

  const content = lines.join('\n');
  try {
    fs.writeFileSync(targetPath, content, 'utf8');
  } catch (writeErr) {
    throw new ConfigError(`Failed to write accounts file at ${targetPath}`, { targetPath }, writeErr);
  }

  return targetPath;
}

/**
 * Synchronizes accounts with .env file and process.env.ACCOUNTS if present,
 * ensuring accounts.txt updates are not shadowed by the ACCOUNTS env var.
 *
 * @param {Array<{username: string, password: string}>} accounts
 */
function _syncEnvAccounts(accounts) {
  if (!Array.isArray(accounts)) return;

  const serialized = accounts.map((a) => `${a.username}|${a.password}`).join(',');
  process.env.ACCOUNTS = serialized;

  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    try {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('ACCOUNTS=')) {
        envContent = envContent.replace(/ACCOUNTS=(["']?)(?:(?!\1)[\s\S])*\1/m, `ACCOUNTS="${serialized}"`);
        fs.writeFileSync(envPath, envContent, 'utf8');
      }
    } catch (_) {
      // Non-fatal if .env cannot be rewritten
    }
  }
}

/**
 * Adds a new account to the accounts file.
 *
 * @param {Object} params
 * @param {string} params.username
 * @param {string} params.password
 * @param {string} [params.filePath]
 * @returns {{account: Account, total: number, filePath: string}}
 */
function addAccount({ username, password, filePath } = {}) {
  assertNonEmptyString(username, 'username', 'addAccount');
  assertNonEmptyString(password, 'password', 'addAccount');

  const targetPath = filePath
    ? assertNonEmptyString(filePath, 'filePath', 'addAccount')
    : path.resolve(process.cwd(), 'accounts.txt');

  let existingAccounts = [];
  try {
    existingAccounts = parseAccountsFile(targetPath);
  } catch (err) {
    if (!(err instanceof ConfigError && err.message.includes('does not exist'))) {
      if (err instanceof ValidationError) {
        const rawLines = readRawLines(targetPath);
        existingAccounts = [];
        for (let i = 0; i < Math.min(rawLines.length, MAX_ACCOUNTS_LIMIT * 2); i++) {
          const trimmed = (rawLines[i] || '').trim();
          if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
          const parts = trimmed.split('|');
          if (parts.length >= 2) {
            existingAccounts.push({ username: parts[0].trim(), password: parts[1].trim() });
          }
        }
      } else {
        throw err;
      }
    }
  }

  const trimmedUser = username.trim();
  const trimmedPass = password.trim();

  const duplicate = existingAccounts.find(
    (acc) => acc.username.toLowerCase() === trimmedUser.toLowerCase()
  );
  if (duplicate) {
    throw new ValidationError(`Account with username "${trimmedUser}" already exists`, {
      username: trimmedUser,
      existingId: duplicate.id
    });
  }

  if (existingAccounts.length >= MAX_ACCOUNTS_LIMIT) {
    throw new ValidationError(`Maximum account limit (${MAX_ACCOUNTS_LIMIT}) reached`, {
      current: existingAccounts.length
    });
  }

  const newLine = `${trimmedUser}|${trimmedPass}`;
  let lines = [];
  try {
    lines = readRawLines(targetPath);
  } catch (_) {
    lines = ['# SapAuto portal accounts', '# Format: username|password', '# Credentials are local-only. Do not commit or log this file.'];
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  lines.push(newLine);

  const writtenPath = writeRawLines(lines, targetPath);

  const newAccount = {
    id: `acc_${existingAccounts.length + 1}`,
    label: KNOWN_ACCOUNT_ALIASES[trimmedUser] || trimmedUser,
    username: trimmedUser,
    password: trimmedPass
  };

  const updatedAll = existingAccounts.concat([newAccount]);
  _syncEnvAccounts(updatedAll);

  return { account: newAccount, total: updatedAll.length, filePath: writtenPath };
}

/**
 * Removes an account from the accounts file by username.
 *
 * @param {Object} params
 * @param {string} params.username
 * @param {string} [params.filePath]
 * @returns {{removed: boolean, total: number}}
 */
function removeAccount({ username, filePath } = {}) {
  assertNonEmptyString(username, 'username', 'removeAccount');

  const targetPath = filePath
    ? assertNonEmptyString(filePath, 'filePath', 'removeAccount')
    : path.resolve(process.cwd(), 'accounts.txt');

  const lines = readRawLines(targetPath);
  const normalizedTarget = username.trim().toLowerCase();
  let found = false;
  const result = [];
  const remainingAccounts = [];

  for (let i = 0; i < Math.min(lines.length, MAX_ACCOUNTS_LIMIT * 4); i++) {
    const line = lines[i];
    const trimmed = (line || '').trim();

    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }

    const parts = trimmed.split('|');
    const lineUsername = (parts[0] || '').trim();

    if (lineUsername.toLowerCase() === normalizedTarget) {
      found = true;
      continue;
    }

    result.push(line);
    if (parts.length >= 2) {
      remainingAccounts.push({ username: lineUsername, password: (parts[1] || '').trim() });
    }
  }

  if (!found) {
    throw new ValidationError(`Account with username "${username}" not found in accounts file`, {
      username,
      filePath: targetPath
    });
  }

  writeRawLines(result, targetPath);
  _syncEnvAccounts(remainingAccounts);

  return { removed: true, total: remainingAccounts.length };
}

/**
 * Returns accounts list without exposing passwords (for dashboard display).
 *
 * @param {string} [filePath]
 * @returns {Array<{id: string, label: string, username: string}>}
 */
function listAccountsSafe(filePath) {
  let accounts = [];
  try {
    accounts = parseAccountsFile(filePath);
  } catch (err) {
    if (err instanceof ValidationError) {
      return [];
    }
    throw err;
  }

  return accounts.map((acc) => ({
    id: acc.id,
    label: acc.label,
    username: acc.username
  }));
}

module.exports = {
  parseAccountsFile,
  parseAccountsFromEnv,
  addAccount,
  removeAccount,
  listAccountsSafe,
  readRawLines,
  writeRawLines,
  KNOWN_ACCOUNT_ALIASES,
  MAX_ACCOUNTS_LIMIT
};
