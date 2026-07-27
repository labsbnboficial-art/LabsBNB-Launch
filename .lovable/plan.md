## Labs Missions — plan de implementación

Sistema de campañas de crecimiento + XP/niveles para todo el ecosistema LabsBNB.

### 1. Base de datos (SQL en `docs/SQL_APPLY.md` + aplicación directa)

- `campaigns` — token_address, creator, presupuesto, moneda (token / LABSBNB / BNB), duración, máx. participantes, recompensa por tarea, estado (draft/active/ended), tx de pago de la comisión.
- `campaign_tasks` — campaign_id, tipo (`follow_x`, `like`, `repost`, `tweet`, `telegram`, `discord`, `buy_min`, `hold`, `stake`, `vote`, `favorite`, `profile`, `referral`, `comment`), obligatoria/opcional, XP, recompensa, parámetros (JSON: cantidad mínima, horas de hold, handle…).
- `campaign_participants` — campaign_id, wallet, estado, XP ganado, recompensa acumulada.
- `task_submissions` — task_id, wallet, prueba (URL/tx hash), estado (`pending`/`auto_verified`/`approved`/`rejected`), verificador.
- `user_xp` — wallet, xp_total, nivel, actualizado.
- `missions` — misiones globales de LabsBNB (diarias/semanales/evento), con las mismas tablas de submissions.
- Vista `user_level` con los tramos: Explorer / Contributor / Ambassador / Elite / Legend.
- RLS: lectura pública de campañas y misiones activas; escritura de submissions solo por el dueño de la wallet; aprobación solo creador de la campaña o admin. GRANTs explícitos.

### 2. Verificación

- **Automática (on-chain, server function con RPC BSC):** compra mínima, hold por tiempo, staking, referidos, votos, favoritos, perfil completo, comentario.
- **Manual / semi-automática (social):** el usuario pega la URL del tweet o su handle; queda `pending` para revisión del creador o del admin. Preparado para conectar la API de X más adelante (campo `verification_mode` por tipo de tarea).
- Antifraude: 1 submission por wallet y tarea, cooldown, wallet con mínimo de antigüedad/actividad configurable, bloqueo por wallets duplicadas por IP hash.

### 3. Frontend

- **`/missions`** — sección fija Labs Missions: pestañas Diarias, Semanales, Eventos, Campañas patrocinadas. Tarjetas con progreso, XP y recompensa.
- **Creación de token (`/create`)** — bloque opcional "🚀 Activar Campaña de Crecimiento" con presupuesto, duración, máx. participantes, recompensa y selección de tareas. Cobro de la comisión de campaña (BNB al wallet admin) antes de activar.
- **`/campaigns/$id`** — vista pública de campaña: lista de tareas, botón de verificar/enviar prueba, ranking de participantes.
- **Panel del creador** (dentro del perfil del token): crear campaña, ver participantes y tareas, aprobar/rechazar tareas manuales, distribuir recompensas.
- **Perfil (`/profile`)** — nivel, XP, barra de progreso, insignias y beneficios desbloqueados.

### 4. Panel de administración (`/admin`)

Nueva pestaña "Missions" con: tipos de tarea habilitados, comisión por crear campaña, recompensa mínima/máxima, redes sociales permitidas, modo de revisión (auto/manual), umbrales antifraude y tramos de XP por nivel. Todo vía `admin_config` con las server functions ya existentes.

### 5. Beneficios por nivel

Descuento de comisión por nivel aplicado en el frontend de trading (y expuesto en config para el contrato), insignia en perfil y comentarios, orden de visibilidad en explorer, acceso anticipado marcado en tarjetas de lanzamiento.

### Detalles técnicos

- Server functions nuevas: `src/lib/missions.functions.ts` (CRUD campañas, submissions, verificación on-chain con viem `createPublicClient`, aprobación admin/creador) y `src/lib/xp.functions.ts` (concesión de XP y cálculo de nivel, idempotente por `(wallet, task_id)`).
- Toda escritura pasa por servidor con `requireSupabaseAuth` + comprobación de que la wallet del perfil coincide con la del actor; nada de confiar en el cliente.
- El pago de la comisión de campaña se verifica leyendo el recibo de la tx en BSC antes de activar la campaña.
- Realtime en la lista de participantes y en el contador de tareas pendientes del creador.

### Fuera de alcance en esta primera entrega

- Integración real con la API de X/Telegram/Discord (queda el flujo manual + los campos listos).
- Distribución automática on-chain de recompensas: primera versión registra la deuda y el creador paga en lote desde el panel.
