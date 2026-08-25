CREATE TABLE IF NOT EXISTS buddy_communication_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT,
  call_sid TEXT,
  stream_sid TEXT,
  event_type TEXT NOT NULL,
  role TEXT,
  text TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buddy_events_contact
  ON buddy_communication_events(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buddy_events_call
  ON buddy_communication_events(call_sid, created_at ASC);

CREATE TABLE IF NOT EXISTS buddy_sms_sessions (
  phone TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  contact_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS buddy_contacts (
  contact_id TEXT PRIMARY KEY,
  phone TEXT,
  contact_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buddy_contacts_phone
  ON buddy_contacts(phone, updated_at DESC);

CREATE TABLE IF NOT EXISTS buddy_docusign_links (
  token TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  contact_id TEXT,
  envelope_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buddy_docusign_contact
  ON buddy_docusign_links(contact_id, created_at DESC);
