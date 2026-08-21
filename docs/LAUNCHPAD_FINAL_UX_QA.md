# LabsBNB Launchpad — FINAL UX QA (solo lectura)

Fecha: 2026-08-21 · Build: `VITE_LAUNCHPAD_NETWORK=testnet` (BSC Testnet, chain 97)
Método: inspección de código + navegación automatizada (Playwright) en 390x844 (móvil) y 1280x1800 (desktop) sobre `http://localhost:8080`.
Rutas verificadas: `/`, `/create`, `/ranking`, `/missions`, `/explorer`, `/profile`, `/notifications`, `/auth`, `/campaigns/new`, `/token/:address` (token real on-chain).

**No se modificó código, contratos, configuración ni se ejecutó ninguna transacción.**

---

## 1. Resumen por severidad

| Sev | # | Resumen |
|---|---|---|
| 🔴 Critical | 3 | Dominio antiguo en señales Telegram; footer con red hardcodeada; loaders infinitos en datos on-chain |
| 🟠 High | 6 | Overflow horizontal en `/create`; 8 enlaces muertos en footer; disclaimer e idioma inaccesibles en móvil; FAB tapa contenido; labels incorrectos en subida de imágenes; mezcla ES/EN |
| 🟡 Medium | 8 | Estados vacíos pobres, info duplicada en token detail, ATH N/A, targets táctiles <36px, SEO duplicado, etc. |
| 🔵 Low | 5 | Warnings de consola, versión "Phase 1", copy menor |
| 🟢 OK | 14 | Ver §3 |

---

## 2. Hallazgos detallados

### 🔴 Critical

**C-1 — Dominio antiguo `lp-burn-stake-gain.lovable.app` en las señales de Telegram**
`src/lib/signals/signal-formatters.ts:7` → `FALLBACK_SITE_URL = "https://lp-burn-stake-gain.lovable.app"`.
Se usa como fallback en 4 rutas de `siteUrl()`: si el admin no configura `site_url`, o lo configura mal / con localhost, **todos los botones de las señales publicadas apuntan al dominio antiguo**. Debe ser `https://labsbnb-launchpad.com`.

**C-2 — Footer con red hardcodeada (rompe el switch a Mainnet)**
`src/components/labsbnb/Footer.tsx` imprime literalmente `BNB Smart Chain Testnet` y `Chain ID 97`. No lee `ACTIVE_NETWORK`. Con `VITE_LAUNCHPAD_NETWORK=mainnet` el footer seguiría diciendo Testnet en todas las páginas.

**C-3 — Loaders infinitos en datos on-chain del token detail**
En `/token/0x7857A2c7…` tras 9 s: chart = "Leyendo eventos Trade on-chain…", Recent trades = "0 eventos" + mismo loader, Top 10 holders = "Leyendo transferencias on-chain…". El RPC público (`bsc-prebsc-dataseed.bnbchain.org`) devuelve errores/HTTP 500 y rechazos de rango (`window 500`, visibles en consola en `/explorer` y `/profile`), y la UI **no tiene timeout ni estado de error**: se queda cargando para siempre. Sin RPC dedicado esto también pasará en Mainnet.

### 🟠 High

**H-1 — Overflow horizontal en `/create` (móvil)**
`scrollWidth = 414` con viewport 390. Elementos culpables: `DIV.flex items-center gap-2` y su `SPAN.text-sm text-muted-foreground` (stepper). El paso **"3 Confirmar" queda cortado** fuera de pantalla.

**H-2 — 8 enlaces muertos en el footer**
`ECOSYSTEM` en `Footer.tsx` define `href: "#"` para Wallet, Swap, Burn Portal, NFT Marketplace, Staking, Casino, NFT Game y Explorer. Ocho botones sin acción en todas las páginas (el propio "Explorer" tiene ruta interna `/explorer` y aun así apunta a `#`).

**H-3 — Disclaimer de riesgo inaccesible en móvil**
`Header.tsx:219` envuelve `<RiskDisclaimer />` en `hidden lg:inline-flex` y `MobileNav` no lo incluye. En teléfonos no hay ninguna forma de abrir el disclaimer legal.

**H-4 — Selector de idioma inaccesible en móvil**
`Header.tsx:226` → `hidden md:inline-flex`; tampoco está en el drawer. Usuarios de teléfono no pueden cambiar ES/EN.

**H-5 — FAB del AI Copilot tapa contenido en móvil**
El botón flotante inferior derecho se superpone a la tarjeta ATH del token detail (verificado en captura) y queda sobre la zona del CTA Comprar/Vender al hacer scroll. No hay padding inferior compensatorio.

**H-6 — Labels incorrectos en `/create`**
Los campos "URL DEL LOGO" y "URL DEL BANNER (OPCIONAL)" renderizan un `<input type=file>` nativo sin estilar ("Choose File / No file chosen"): el texto no corresponde al control, rompe el diseño glass y es el único control no tematizado de la app.

### 🟡 Medium

**M-1 — Mezcla de idiomas en la misma vista.** Token detail combina "PAY WITH", "YOU RECEIVE (EST.)", "REFERRER", "Slippage", "Progress" con "Comprar", "Vender", "VOLUMEN", "OPERACIONES", "PROGRESO DE LA CURVA". El drawer móvil mezcla "Launchpad / Create Token / Rankings" con "Nueva campaña".

**M-2 — Información duplicada en token detail.** La descripción del token aparece dos veces (cabecera y "Token information"); Progress / Liquidity / Market cap se repiten en el panel de curva y dentro del TradePanel; "PROGRESO DE LA CURVA 0.2%" duplica "Progress 0.2%".

**M-3 — ATH vacío y poco profesional.** Bloque ATH muestra `N/A` en las 5 celdas (ATH, ATH PRICE, ATH DATE, DISTANCE FROM ATH, ATH MARKET CAP) para un token con operaciones; deriva de C-3 (sin eventos, sin ATH).

**M-4 — Métricas contradictorias.** El mismo token muestra `24H VOLUME 0.050 BNB`, `+6.30% 24h` y a la vez `BUYS/SELLS 0/0`, `OPERACIONES 0`, `TRADERS 0` y "Recent trades: 0 eventos". Fuentes mezcladas (estado de curva vs. eventos) sin conciliar.

**M-5 — `Target: — BNB` en la barra de progreso.** El objetivo de graduación se renderiza como guion; el usuario no sabe cuánto falta.

**M-6 — Targets táctiles menores a 36 px.** Home: "View all →" (16 px alto) y los 8 enlaces del footer (20 px alto). Por debajo del mínimo recomendado (44 px iOS / 48 dp Android).

**M-7 — Estados vacíos genéricos.** `/ranking`: "No tokens yet in this category." sin CTA; comentarios: "No comments yet." sin invitación a conectar wallet; Missions con 0 XP no explica cómo empezar.

**M-8 — SEO: título de `/` idéntico al de `__root`.** Ambos "LabsBNB Launchpad — Launch tokens on BNB Chain". El token detail usa `Token 0x0738dA58 — …` (dirección truncada) en vez del nombre real; ninguna ruta declara `og:image` absoluta.

### 🔵 Low

- **L-1** Consola: `Lit is in dev mode` en todas las páginas (WalletConnect modal) — solo dev.
- **L-2** Consola `/explorer`: dos `Failed to load resource: 500` + warning de rango de logs. Sin impacto visible, pero ruido en producción.
- **L-3** Footer: `v1.0 · Phase 1` — texto interno que llega al usuario final.
- **L-4** `/token/<factory>` inválido muestra solo "Token no encontrado", sin botón de vuelta ni sugerencia.
- **L-5** `siwe.functions.ts:46`, `use-siwe.ts:25`, `web3/config.ts:22-23` usan `labsbnb.app` como dominio/icono por defecto — no es el dominio productivo `labsbnb-launchpad.com`.

---

## 3. 🟢 Funcionalidades verificadas OK

1. Las 10 rutas responden **HTTP 200** en móvil y desktop, sin pantallas en blanco ni errores de JS (`pageerror` = 0).
2. Home renderiza tokens reales on-chain con enlaces `/token/0x…` válidos.
3. Explorer lista tokens (Latest tokens) con datos y estado ACTIVE.
4. Rankings carga sus 5 pestañas (New, Trending, Top gainers, Top losers, Graduated).
5. Missions muestra niveles XP (Explorer / Contributor / Ambassador) y progreso.
6. `/campaigns/new` renderiza el formulario completo con moneda de premio (Token / LabsBNB / BNB / NFT).
7. Gating de sesión correcto: `/profile` y `/notifications` redirigen a `/auth` con `search.redirect` y vuelven al destino.
8. `/auth` ofrece WalletConnect, Injected y Coinbase Wallet; detección EIP-6963 con estado "Detectando wallets…"; SIWE fuerza chain 97 antes de firmar.
9. `NetworkGuard` funciona: banner TESTNET siempre visible y panel "Wrong network" con botón Switch (current vs required) desde `networks.ts`.
10. Drawer móvil (`MobileNav`) abre/cierra, bloquea scroll, cierra con Escape y en cambio de ruta; todos sus destinos existen.
11. Sin overflow horizontal en 9 de 10 rutas móviles y en las 10 de desktop.
12. TradePanel renderiza precio en vivo, presets (0.01/0.05/0.1/0.5), slippage, referrer y estimación — sin ejecutar transacciones.
13. Enlaces sociales del token normalizados a https por `normalizeSocial()` (handle → URL canónica) y renderizados como Web / X / TG.
14. Enlaces de explorer centralizados en `networks.ts` (`explorerAddressUrl/TxUrl/TokenUrl`); no hay URLs de bscscan hardcodeadas fuera de ese módulo.

---

## 4. Clasificación solicitada

**Problemas exclusivamente visuales:** H-1 (stepper cortado), H-5 (FAB solapado), H-6 (inputs file sin estilar), M-2 (duplicados), M-3 (ATH N/A), M-6 (targets táctiles), M-7 (vacíos), L-3.

**Problemas funcionales:** C-1 (dominio en señales), C-2 (red hardcodeada), C-3 (loaders infinitos / RPC), H-2 (enlaces muertos), H-3, H-4 (controles inaccesibles), M-4 (métricas contradictorias), M-5 (target vacío), L-2, L-5.

**Problemas de móvil:** H-1, H-3, H-4, H-5, H-6, M-6, C-3 (agrava por RPC lento en redes móviles).

**Problemas de desktop:** C-1, C-2, C-3, H-2, H-6, M-1, M-2, M-4, M-5, M-8, L-2. Sin overflow ni recortes detectados en 1280 px.

**Referencias Testnet restantes:**
- Intencionales/centralizadas: `src/lib/web3/networks.ts`, `src/lib/web3/rpc.ts` (definiciones de ambas redes).
- **No centralizadas (deben corregirse):** `src/components/labsbnb/Footer.tsx` (texto "BNB Smart Chain Testnet" + "Chain ID 97" hardcodeado); `src/routes/auth.tsx` usa `bscTestnet.id` importado de `wagmi/chains` en 5 puntos en lugar de `ACTIVE_NETWORK.chainId`, incluido el copy "switch to BNB Testnet".

---

## 5. Recomendaciones antes de Mainnet (orden sugerido)

1. Sustituir `FALLBACK_SITE_URL` por `https://labsbnb-launchpad.com` y forzar el dominio productivo en metadata de WalletConnect y SIWE (C-1, L-5).
2. Hacer que Footer y `auth.tsx` lean `ACTIVE_NETWORK` (nombre, chainId, copy del switch). Regla: cero literales `97`/`Testnet` fuera de `networks.ts` (C-2, referencias Testnet).
3. Contratar/configurar **RPC dedicado** para BSC Mainnet y añadir timeout + estado de error con reintento en chart, recent trades y holders; nunca dejar un loader sin límite (C-3).
4. Corregir el overflow del stepper de `/create` (scroll horizontal contenido o stepper compacto en <420 px) y estilar los inputs de imagen con el label correcto (H-1, H-6).
5. Dar destino real a los 8 enlaces del ecosistema o quitarlos hasta que existan (H-2).
6. Exponer disclaimer e idioma dentro del drawer móvil; añadir `padding-bottom` para el FAB (H-3, H-4, H-5).
7. Unificar idioma por locale en token detail y drawer (M-1) y eliminar duplicados de descripción/métricas (M-2).
8. Conciliar la fuente de métricas: si los eventos Trade fallan, marcar las tarjetas como "sin datos" en vez de mostrar 0 junto a volumen positivo (M-4, M-3, M-5).
9. Títulos/descripciones únicos por ruta, nombre real del token en el head y `og:image` absoluta (M-8).
10. Repetir esta QA tras el despliegue del Factory de Mainnet: hoy `networkSafetyCheck()` devuelve `ok:false` porque `mainnet.contracts.factory` es `null` (correcto, no inventar dirección).
