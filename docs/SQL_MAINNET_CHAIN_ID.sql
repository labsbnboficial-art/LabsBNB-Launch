-- LabsBNB — Mainnet network tagging (chain_id)
-- Safe, additive, backward-compatible. Does NOT delete or reset any data.
-- Historical Testnet rows keep chain_id = 97; new rows default to 56.
-- Run once in the Supabase SQL editor.

ALTER TABLE public.tokens ALTER COLUMN chain_id SET DEFAULT 56;

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS chain_id integer NOT NULL DEFAULT 97;
ALTER TABLE public.trades ALTER COLUMN chain_id SET DEFAULT 56;

ALTER TABLE public.bonding_curves ADD COLUMN IF NOT EXISTS chain_id integer NOT NULL DEFAULT 97;
ALTER TABLE public.bonding_curves ALTER COLUMN chain_id SET DEFAULT 56;

CREATE INDEX IF NOT EXISTS tokens_chain_id_idx ON public.tokens (chain_id);
CREATE INDEX IF NOT EXISTS trades_chain_id_idx ON public.trades (chain_id);
CREATE INDEX IF NOT EXISTS bonding_curves_chain_id_idx ON public.bonding_curves (chain_id);
