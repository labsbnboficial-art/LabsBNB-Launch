# Manual SQL to apply on the Supabase project (SQL editor)

Migrations tool isn't wired for this project, so apply this once from Cloud → SQL editor.

```sql
-- Notifications piggyback on activity(kind='notification', user_id).
create index if not exists activity_notifications_idx
  on public.activity (user_id, created_at desc)
  where kind = 'notification';

-- Creator reputation view.
create or replace view public.creator_reputation as
select
  p.id                                as user_id,
  p.username,
  p.wallet_address,
  p.avatar_url,
  count(distinct t.id)                as tokens_created,
  count(distinct t.id) filter (where t.status = 'graduated') as tokens_graduated,
  coalesce(sum(tr.amount_bnb), 0)     as total_volume_bnb,
  count(distinct tr.wallet_address)   as unique_traders
from public.profiles p
left join public.tokens t on t.creator_id = p.id
left join public.trades tr on tr.token_id = t.id
group by p.id, p.username, p.wallet_address, p.avatar_url;

grant select on public.creator_reputation to anon, authenticated;

-- AntiBot knobs (todo configurable desde /admin).
insert into public.admin_config (key, value, is_public) values
  ('antibot_enabled',        to_jsonb(false),     true),
  ('antibot_max_buy_bnb',    to_jsonb('0'::text), true),
  ('antibot_max_wallet_tk',  to_jsonb('0'::text), true),
  ('antibot_max_tx_tk',      to_jsonb('0'::text), true),
  ('antibot_cooldown_s',     to_jsonb(0),         true),
  ('antibot_anti_sandwich',  to_jsonb(true),      true),
  ('antibot_anti_flashloan', to_jsonb(true),      true)
on conflict (key) do nothing;
```
