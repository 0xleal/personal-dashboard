create table sessions (
  session_id text primary key,
  status text not null default 'idle',
  cwd text not null default '',
  project text not null default '',
  model text not null default '',
  current_activity text not null default '',
  last_event_at bigint not null,
  status_changed_at bigint not null
);
