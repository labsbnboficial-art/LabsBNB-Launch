
REVOKE EXECUTE ON FUNCTION public.is_admin_wallet(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_wallet(uuid) TO service_role;
