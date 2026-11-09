alter table barcox.scan_sessions
  drop constraint if exists scan_sessions_session_number_key;

alter table barcox.scan_sessions
  add constraint scan_sessions_owner_session_number_key
  unique (owner_id, session_number);
