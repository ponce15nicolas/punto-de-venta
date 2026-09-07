# PROJECT_CONTEXT.md — Arquitectura actual del POS

Este documento resume la arquitectura observada en el repositorio actual para ayudar a Codex a orientarse rápidamente.

No sustituye al código. Si hay una contradicción, manda el código actual.

## Entrada principal

- `src/main.jsx`
  - aplica tema inicial;
  - registra PWA;
  - renderiza `App`.

- `src/App.jsx`
  - `/admin` -> `AdminRoute`
  - resto -> POS
  - ejecuta una sola instancia de `useLicenseCheck`
  - integra `OperatorGate`/sesión interna
  - crea `usePosData`
  - gestiona navegación, shortcuts, scanner HID y modos visuales

## Autenticación y acceso

### Cliente POS

- `src/components/Login.jsx`
- Google Sign-In exclusivamente.
- `src/hooks/useLicenseCheck.js`
  - licencia;
  - cliente;
  - dispositivo;
  - sesión;
  - heartbeat;
  - acceso offline.

### Operadores internos

- `src/components/OperatorGate.jsx`
- roles:
  - administrador
  - encargado

### Admin global

- `src/components/AdminRoute.jsx`
- `src/components/AdminLogin.jsx`
- `src/components/AdminPanel.jsx`
- autorización mediante `admins/{uid}`.

## Estado de negocio

`src/hooks/usePosData.js`

Expone actualmente:

- `catalog`
- `sales`
- `cashSessions`
- `accountsReceivable`
- `shoppingList`
- `accountsPayable`
- `promotions`
- `shopName`
- `ticketConfig`
- `cart`
- `openSession`

Acciones importantes:

- productos;
- promociones;
- carrito;
- checkout;
- abrir/cerrar caja;
- convertir fondos;
- cuentas por cobrar;
- compras;
- cuentas por pagar;
- migración de ganancias.

## Backend POS

`src/services/pos/posFirestore.js`

Wrappers de Cloud Functions y suscripciones Firestore.

`functions/index.js`

Backend autoritativo para mutaciones críticas.

## Rutas Firestore

Centralizadas en:

`src/services/pos/posPaths.js`

Base multi-tenant:

```text
clientes/{clienteId}/...
```

Colecciones principales:

- productos
- ventas
- cajas
- cuentasPorCobrar
- cuentasPorPagar
- listaCompras
- auditoria
- configuracion

## Seguridad

- `firestore.rules`
- `src/firebase/Firebase.rules`
- `scripts/check-pos-security-boundary.mjs`

El navegador no debe escribir directamente en colecciones POS protegidas.

Validación recomendada:

```bash
npm run check
```

## Modo offline

- `src/lib/offlineAccess.js`
- `src/lib/offlineQueue.js`
- `src/lib/network.js`
- `src/components/OfflineStatusBar.jsx`
- `src/components/SyncCenterModal.jsx`

IndexedDB:

```text
mi-negocio-pos-offline
```

Stores:

- operations
- syncHistory

La cola soporta ventas pendientes y reconciliación posterior.

## PWA

- `src/lib/pwa.js`
- `public/sw.js`
- `public/manifest.webmanifest`

Service Worker se registra únicamente en producción.

## Páginas

### `src/pages/Vender.jsx`

Pantalla crítica de venta:
- scanner;
- carrito;
- venta por unidad/peso/libre;
- promociones;
- cobro;
- tickets.

### `src/pages/Inventario.jsx`

- catálogo;
- altas/edición;
- stock;
- vencimientos;
- promociones.

### `src/pages/Caja.jsx`

- caja actual;
- apertura/cierre;
- ventas del turno;
- formas de pago;
- cuentas por cobrar.

### `src/pages/Historial.jsx`

- sesiones;
- detalle;
- ventas;
- auditoría por sesión;
- PDF;
- eliminación controlada.

### `src/pages/Actividad.jsx`

- timeline general de auditoría.

### `src/pages/Compras.jsx`

- lista de compras;
- cuentas por pagar.

### `src/pages/CuentasPorCobrar.jsx`

- deudas;
- pagos;
- historial de cuenta.

### `src/pages/Ganancias.jsx`

- métricas;
- ganancias;
- migración histórica.

### `src/pages/Arca.jsx`

- configuración ARCA mediante backend.

## Auditoría

- `src/services/pos/auditoriaFirestore.js`
- consulta general y por `sessionId`.
- índice Firestore existente:
  - `sessionId ASC`
  - `fecha ASC`

Regla de producto:
El PDF específico de auditoría contiene sólo cronología de eventos de la sesión.

## UI

`src/index.css`

Sistema visual:
- Tailwind v4
- dark/light
- amarillo `#FFC61A`
- fondo oscuro `#0B0D12`
- Liquid Glass
- overrides responsive

Breakpoint estructural desktop observado:

```css
@media (min-width: 900px)
```

## Tema

Storage:

```text
pos-theme
```

Valores:

- dark
- light

## Efectos

Storage:

```text
pos-effects
```

Valores:

- complete
- balanced
- performance

## Scanner y teclado

`App.jsx` contiene lógica para:
- Numpad;
- teclado notebook;
- scanner HID;
- protección sobre inputs;
- bloqueo con dialogs.

No modificar tiempos/handlers sin probar lector físico o flujo equivalente.

## Dependencias principales actuales

Root:

- firebase `^12.17.1`
- html5-qrcode `^2.3.8`
- jspdf `^4.2.1`
- motion `^13.1.0`
- react `^19.2.8`
- react-dom `^19.2.8`
- vite `^8.2.0`
- tailwindcss `^4.3.3`
- oxlint `^1.75.0`

Functions:

- firebase-admin `^13.6.0`
- firebase-functions `^7.0.0`
- Node 22

## Validación

Frontend:

```bash
npm run check
```

Funciones:

```bash
cd functions
npm run check
```

Prueba preferida de build:

```bash
npm run preview
```

## Documentación histórica

`README.md` todavía describe una etapa anterior basada principalmente en `localStorage`.

La aplicación actual ya posee Firebase, multi-tenant, Cloud Functions, licencias, operadores, offline/PWA y sincronización.

Por lo tanto, para decisiones técnicas debe preferirse el código actual.
