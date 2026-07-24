
-- =========================================
-- LabsBNB Launchpad — Phase 1 schema
-- =========================================

-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Token status enum
CREATE TYPE public.token_status AS ENUM ('pending', 'active', 'graduated', 'failed');

-- Trade side enum
CREATE TYPE public.trade_side AS ENUM ('buy', 'sell');

-- ---------- profiles ----------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT UNIQUE,
  username TEXT UNIQUE,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are publicly viewable" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ---------- user_roles ----------
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ---------- tokens ----------
CREATE TABLE public.tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contract_address TEXT UNIQUE,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  banner_url TEXT,
  website TEXT,
  telegram TEXT,
  twitter TEXT,
  discord TEXT,
  github TEXT,
  category TEXT,
  supply NUMERIC(78,0) NOT NULL DEFAULT 1000000000,
  decimals INT NOT NULL DEFAULT 18,
  chain_id INT NOT NULL DEFAULT 56,
  status public.token_status NOT NULL DEFAULT 'pending',
  deploy_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  graduated_at TIMESTAMPTZ
);
CREATE INDEX idx_tokens_status ON public.tokens(status);
CREATE INDEX idx_tokens_created_at ON public.tokens(created_at DESC);
GRANT SELECT ON public.tokens TO anon;
GRANT SELECT, INSERT, UPDATE ON public.tokens TO authenticated;
GRANT ALL ON public.tokens TO service_role;
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tokens publicly viewable" ON public.tokens FOR SELECT USING (true);
CREATE POLICY "Auth users create tokens" ON public.tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creator updates own token" ON public.tokens FOR UPDATE TO authenticated USING (auth.uid() = creator_id);
CREATE POLICY "Admins update any token" ON public.tokens FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------- bonding_curves ----------
CREATE TABLE public.bonding_curves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL UNIQUE REFERENCES public.tokens(id) ON DELETE CASCADE,
  virtual_bnb_reserves NUMERIC(78,0) NOT NULL DEFAULT 0,
  virtual_token_reserves NUMERIC(78,0) NOT NULL DEFAULT 0,
  real_bnb_reserves NUMERIC(78,0) NOT NULL DEFAULT 0,
  target_bnb NUMERIC(78,0) NOT NULL DEFAULT 24000000000000000000,
  progress_bps INT NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bonding_curves TO anon;
GRANT SELECT ON public.bonding_curves TO authenticated;
GRANT ALL ON public.bonding_curves TO service_role;
ALTER TABLE public.bonding_curves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Curves publicly viewable" ON public.bonding_curves FOR SELECT USING (true);

-- ---------- trades ----------
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  wallet_address TEXT NOT NULL,
  side public.trade_side NOT NULL,
  amount_bnb NUMERIC(78,0) NOT NULL,
  amount_token NUMERIC(78,0) NOT NULL,
  price NUMERIC(38,18) NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trades_token ON public.trades(token_id, created_at DESC);
GRANT SELECT ON public.trades TO anon;
GRANT SELECT ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trades publicly viewable" ON public.trades FOR SELECT USING (true);

-- ---------- fees ----------
CREATE TABLE public.fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  wallet_address TEXT NOT NULL,
  amount NUMERIC(78,0) NOT NULL,
  fee_bps INT NOT NULL,
  destination_wallet TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fees_created_at ON public.fees(created_at DESC);
GRANT SELECT ON public.fees TO authenticated;
GRANT ALL ON public.fees TO service_role;
ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view fees" ON public.fees FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------- favorites / watchlist ----------
CREATE TABLE public.favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_id UUID NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token_id)
);
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own favorites" ON public.favorites FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------- comments ----------
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_token ON public.comments(token_id, created_at DESC);
GRANT SELECT ON public.comments TO anon;
GRANT SELECT, INSERT, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Comments publicly viewable" ON public.comments FOR SELECT USING (true);
CREATE POLICY "Users insert own comments" ON public.comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own comments" ON public.comments FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));

-- ---------- reports ----------
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_id UUID REFERENCES public.tokens(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users create reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Reporter sees own reports" ON public.reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));

-- ---------- activity ----------
CREATE TABLE public.activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token_id UUID REFERENCES public.tokens(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_created_at ON public.activity(created_at DESC);
GRANT SELECT ON public.activity TO anon;
GRANT SELECT ON public.activity TO authenticated;
GRANT ALL ON public.activity TO service_role;
ALTER TABLE public.activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Activity publicly viewable" ON public.activity FOR SELECT USING (true);

-- ---------- audit_logs (admin only) ----------
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view audit" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------- admin_config ----------
-- Public read of NON-sensitive keys, admin write.
CREATE TABLE public.admin_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_config TO anon;
GRANT SELECT ON public.admin_config TO authenticated;
GRANT ALL ON public.admin_config TO service_role;
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public config readable" ON public.admin_config FOR SELECT USING (is_public = true OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins write config" ON public.admin_config FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ---------- updated_at helper ----------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_curves_updated BEFORE UPDATE ON public.bonding_curves FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_config_updated BEFORE UPDATE ON public.admin_config FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- auto profile on signup ----------
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- seed admin_config ----------
INSERT INTO public.admin_config (key, value, is_public) VALUES
  ('fee_bps', '50'::jsonb, true),
  ('fee_wallet', '"0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e"'::jsonb, true),
  ('chain_id', '56'::jsonb, true),
  ('curve_target_bnb', '"24000000000000000000"'::jsonb, true),
  ('supported_pay_tokens', '["BNB","LABSBNB","USDT","USDC"]'::jsonb, true),
  ('ecosystem_links', '{"wallet":"#","swap":"#","burn":"#","nft":"#","staking":"#","casino":"#","game":"#","explorer":"#"}'::jsonb, true)
ON CONFLICT (key) DO NOTHING;
