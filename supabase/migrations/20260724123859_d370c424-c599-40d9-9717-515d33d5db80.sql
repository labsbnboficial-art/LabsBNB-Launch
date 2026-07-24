
-- Ensure wallet_address is unique on profiles
CREATE UNIQUE INDEX IF NOT EXISTS profiles_wallet_address_key
  ON public.profiles (lower(wallet_address)) WHERE wallet_address IS NOT NULL;

-- Helper: does the calling user own the admin wallet?
CREATE OR REPLACE FUNCTION public.is_admin_wallet(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.admin_config c ON c.key = 'admin_wallet'
    WHERE p.id = _user_id
      AND p.wallet_address IS NOT NULL
      AND lower(p.wallet_address) = lower(trim(both '"' from c.value::text))
  );
$$;

-- Seed / update admin_config with all launcher parameters
INSERT INTO public.admin_config (key, value, is_public) VALUES
  ('admin_wallet',      '"0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"'::jsonb, true),
  ('admin_pin_hash',    'null'::jsonb, false),
  ('factory_address',   'null'::jsonb, true),
  ('rpc_url',           '"https://data-seed-prebsc-1-s1.binance.org:8545"'::jsonb, true),
  ('chain_id',          '97'::jsonb, true),
  ('fee_bps',           '50'::jsonb, true),
  ('fee_wallet',        '"0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"'::jsonb, true),
  ('curve_target_bnb',  '"24000000000000000000"'::jsonb, true),
  ('burn_pct',          '0'::jsonb, true),
  ('liquidity_pct',     '100'::jsonb, true),
  ('lp_pct',            '0'::jsonb, true),
  ('staking_pct',       '0'::jsonb, true),
  ('creation_fee_bnb',  '"0"'::jsonb, true),
  ('buy_fee_bps',       '50'::jsonb, true),
  ('sell_fee_bps',      '50'::jsonb, true),
  ('staking_cost_bnb',  '"0"'::jsonb, true),
  ('indexer_cursor',    '0'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

-- Rewrite admin_config write policy to allow admin role OR admin wallet
DROP POLICY IF EXISTS "admins can manage config" ON public.admin_config;
DROP POLICY IF EXISTS "admin_config_admin_write" ON public.admin_config;
CREATE POLICY "admin_config_admin_write"
  ON public.admin_config
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.is_admin_wallet(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.is_admin_wallet(auth.uid()));
