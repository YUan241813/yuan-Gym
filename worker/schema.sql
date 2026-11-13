-- yuan-Gym on D1. One row per account, one per session, one per user for the synced state.
--
-- Everything that was a file under server/data/ in the Node build is a row here, and the shapes
-- are deliberately the same: users, sessions, codes, states, events. The only new table is
-- `limits`, which stands in for the in-memory attempt counter the Node server kept — a Worker has
-- no memory between requests, so the counter has to live somewhere both requests can see.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_lower    TEXT NOT NULL UNIQUE,
  -- Optional, and unverified: an account is a name and a password. When a client sends one it is
  -- only a second thing to sign in with. NULL rather than '' so many accounts can omit it.
  email         TEXT,
  email_lower   TEXT UNIQUE,
  -- PBKDF2-SHA512(password, salt) as hex, derived on the client (see app/frontend/src/lib/pw.js)
  verifier      TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  logins        INTEGER NOT NULL DEFAULT 0,
  ip            TEXT,
  ua            TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token   TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exp     INTEGER NOT NULL,
  ip      TEXT,
  ua      TEXT,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS codes (
  key     TEXT PRIMARY KEY,   -- "register:<email>" / "reset:<email>"
  code    TEXT NOT NULL,
  exp     INTEGER NOT NULL,
  tries   INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS states (
  user_id    TEXT PRIMARY KEY,
  rev        INTEGER NOT NULL DEFAULT 0,
  state      TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  t       INTEGER NOT NULL,
  type    TEXT NOT NULL,
  user_id TEXT,
  name    TEXT,
  ip      TEXT,
  ua      TEXT,
  meta    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);

CREATE TABLE IF NOT EXISTS limits (
  key   TEXT PRIMARY KEY,     -- "<action>:<ip>"
  n     INTEGER NOT NULL,
  until INTEGER NOT NULL
);
