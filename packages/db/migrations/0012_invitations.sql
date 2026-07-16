create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email citext not null,
  role membership_role not null default 'admin',
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),
  invited_by text not null references profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

create index if not exists idx_invitations_email on invitations(email);
create index if not exists idx_invitations_token on invitations(token);
create index if not exists idx_invitations_org on invitations(org_id);
