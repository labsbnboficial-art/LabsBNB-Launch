"Todo lo especificado" es un proyecto de varias semanas (contratos auditados, WebSockets de precios, indexador on-chain, panel admin completo, moderación, 2FA, integraciones cross-app). Voy a entregarlo por **fases reales**, no en un solo turno — si intento todo de golpe queda medio hecho y con datos falsos, que es justo lo que pediste evitar.

## Fase 1 (esta iteración) — Fundación + UI premium

### Diseño y sistema
- Sistema de diseño LabsBNB en `src/styles.css`: paleta azul oscuro / negro / azul eléctrico / cian, glassmorphism, glow, bordes suaves, animaciones.
- Layout base con header (logo, nav, conexión wallet, selector idioma ES/EN), footer con links al ecosistema.
- i18n ligero (contexto React, ES/EN) desde el inicio.

### Backend (Lovable Cloud)
- Activar Lovable Cloud.
- Esquema real (migración) con RLS y GRANTs correctos:
  `profiles`, `user_roles` (con `has_role`), `tokens`, `bonding_curves`, `trades`, `fees`, `comments`, `favorites`, `watchlist`, `reports`, `activity`, `admin_config`, `audit_logs`.
- Seed de `admin_config` con:
  - `fee_bps = 50` (0.50%)
  - `fee_wallet = 0x60e655Fe39Bc7D17661f226bB44Dcc681cc4e05e`
  - `chain_id = 56`

### Wallet y Web3
- `wagmi` + `viem` + connectors: Injected (MetaMask/Trust), WalletConnect. LabsBNB Wallet queda como conector custom preparado (interfaz lista, TODO doc).
- Red: BNB Smart Chain mainnet (56).
- Hooks: `useLabsBnbPrice` (DexScreener API real), `useConnect`, `useAccount`.

### Rutas (TanStack Start)
- `/` Landing: hero + precio LabsBNB real + stats (market cap / vol via DexScreener) + secciones vacías bien marcadas para "últimos tokens", "trending", "próximos a completar curva" que se llenan cuando existan tokens reales en DB (sin mocks).
- `/create` Wizard 3 pasos (UI + validación Zod + guardado en DB como "pending deploy"; el deploy on-chain queda como server fn con TODO conectando al factory cuando esté).
- `/token/$address` Página de token (lee de DB; muestra estados vacíos honestos hasta que existan trades reales).
- `/ranking` Rankings.
- `/profile` Perfil del usuario conectado.
- `/admin` Panel admin gateado por rol `admin` — dashboard + edición de `admin_config` (comisión, wallet receptora, límites).
- `/auth` para email/password (creadores que no quieran sólo wallet).

### Lo que NO entra en Fase 1 (y por qué)
- **Contratos de bonding curve reales**: requieren desarrollo Solidity + auditoría. Dejo la interfaz `IBondingCurveFactory` (ABI placeholder documentado) + server fn `deployToken` con TODO explícito. Cuando tengas la dirección del factory desplegado, se enchufa en 1 sesión.
- **WebSockets de precios en vivo**: en Fase 1 uso polling a DexScreener (real, no mock). WS custom requiere indexador on-chain propio.
- **Gráfico de velas TradingView-like**: en Fase 1 uso `lightweight-charts` alimentado por los trades reales de DB (vacío hasta que haya trades). No pongo velas falsas.
- **Panel admin completo** (moderación, soporte, auditoría UI, banners): Fase 1 entrega dashboard + configuración + tokens + comisiones + logs. El resto en Fase 2.
- **2FA admin, casino/juego NFT/staking cross-links**: Fase 2 (los links del ecosistema apuntan a `#` con TODO).
- **Indexador on-chain de trades / holders**: necesita worker aparte; Fase 2.

## Fases siguientes (te propongo después)
- **Fase 2**: Contratos + integración factory + indexador de eventos → trades/holders reales.
- **Fase 3**: Gráficos avanzados + WebSockets + rankings vivos.
- **Fase 4**: Social (comentarios, likes, seguir, insignias) + moderación + reportes.
- **Fase 5**: 2FA admin, auditoría UI, banners, categorías avanzadas.
- **Fase 6**: Integración nativa cross-app del ecosistema (SSO wallet, deep links).

## Detalles técnicos clave
- Stack: TanStack Start (ya montado) + Lovable Cloud (Supabase) + wagmi/viem + shadcn.
- Todas las lecturas de precio: DexScreener API pública (sin key).
- Comisión configurable server-side (`admin_config` table, lectura pública `TO anon` sólo de campos no sensibles).
- Roles: tabla `user_roles` separada + `has_role()` SECURITY DEFINER (nunca en `profiles`).
- Idiomas: ES por defecto, toggle EN en header.
- Sin datos demo: donde no hay datos, UI muestra estado vacío profesional ("Aún no hay tokens creados — sé el primero").

¿Apruebas empezar por Fase 1 con este alcance? Si quieres que priorice algo distinto dentro de Fase 1 (por ejemplo, saltar admin y hacer gráfico avanzado ya), dímelo antes de que empiece.
