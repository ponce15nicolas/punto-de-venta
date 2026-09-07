# AGENTS.md — Punto de venta POS

## Propósito

Este archivo define cómo debe trabajar Codex dentro de este repositorio.

Este POS es una aplicación real de gestión comercial. Las prioridades son, en este orden:

1. Integridad de datos.
2. Seguridad.
3. No introducir regresiones.
4. Mantener el flujo operativo del comercio.
5. Compatibilidad online/offline.
6. UX responsive.
7. Código simple y mantenible.

Antes de cambiar código, leer la implementación actual y limitar el cambio al alcance solicitado.

---

## 1. Fuente de verdad

La fuente de verdad es el código actual del repositorio.

Antes de modificar un archivo:

- leer su versión actual;
- revisar imports/exports;
- buscar todos sus consumidores;
- revisar servicios, hooks y Cloud Functions relacionados;
- comprobar si el cambio afecta modo offline, auditoría, caja, stock, licencias u operadores.

No restaurar implementaciones antiguas desde backups, patches, diffs o documentación histórica.

### README

`README.md` contiene información histórica que ya no describe por completo la arquitectura actual.

No usar `README.md` como fuente principal para decidir:

- persistencia;
- autenticación;
- arquitectura Firebase;
- seguridad;
- sincronización;
- flujos actuales.

Preferir siempre:

- `package.json`
- `src/`
- `functions/`
- `firestore.rules`
- `firebase.json`
- scripts de validación

---

## 2. Stack real actual

Frontend:

- React 19
- Vite 8
- Tailwind CSS 4
- Motion
- Firebase Web SDK
- html5-qrcode
- jsPDF

Backend:

- Firebase Authentication
- Cloud Firestore
- Cloud Functions
- Cloud Storage

Entorno:

- Node.js 22 como entorno de trabajo preferido.
- `functions/package.json` fija Node.js 22.
- El paquete raíz acepta Node `>=20.19.0`.

Región de Cloud Functions:

` southamerica-east1 `

No cambiar región o runtime sin una razón explícita.

---

## 3. Comandos de validación

Revisar primero los scripts disponibles en `package.json`.

Para cambios normales del frontend usar preferentemente:

```bash
npm run check
```

Actualmente `npm run check` ejecuta:

1. `npm run lint`
2. `npm run check:security-boundary`
3. `npm run build`

Para Cloud Functions, cuando `functions/index.js` sea modificado:

```bash
cd functions
npm run check
```

Cuando corresponda probar la build localmente:

```bash
npm run preview
```

El usuario prefiere validar mediante `preview` en lugar de depender del servidor de desarrollo.

Nunca dar una tarea por terminada con errores introducidos por el cambio.

---

## 4. Frontera de seguridad crítica

Existe un límite de seguridad deliberado entre frontend y backend.

El navegador NO debe recuperar primitivas directas de escritura Firestore para las áreas protegidas.

El script:

```bash
npm run check:security-boundary
```

verifica esta regla.

No introducir en `src/` primitivas como:

- `addDoc`
- `setDoc`
- `updateDoc`
- `deleteDoc`
- `writeBatch`
- `runTransaction`
- `serverTimestamp`
- `arrayUnion`

si eso rompe el límite actual de seguridad.

Las mutaciones sensibles deben seguir pasando por Cloud Functions.

No reemplazar un callable existente por una escritura Firestore directa para “simplificar” código.

---

## 5. Firestore: aislamiento por cliente

Los datos operativos del POS están separados por cliente.

La estructura principal está centralizada en:

`src/services/pos/posPaths.js`

Estructura relevante:

```text
clientes/{clienteId}/productos/{productoId}
clientes/{clienteId}/ventas/{ventaId}
clientes/{clienteId}/cajas/{cajaId}
clientes/{clienteId}/cuentasPorCobrar/{cuentaId}
clientes/{clienteId}/cuentasPorPagar/{cuentaId}
clientes/{clienteId}/listaCompras/{itemId}
clientes/{clienteId}/auditoria/{eventoId}
clientes/{clienteId}/configuracion/pos
clientes/{clienteId}/configuracion/migracion-pos-v1
```

Nunca escribir o leer datos de un cliente utilizando otro `clienteId`.

No eliminar la validación de segmentos de ruta.

Para productos, respetar `getProductDocumentId()` y el código de barras original.

No duplicar strings de rutas si ya existe un helper en `posPaths.js`.

---

## 6. Firestore Rules

Las reglas actuales permiten lecturas controladas de datos operativos y bloquean escrituras directas desde cliente en colecciones críticas.

No relajar reglas para solucionar rápidamente un error del frontend.

Especialmente no permitir escrituras directas sobre:

- productos;
- ventas;
- cajas;
- configuración;
- cuentas;
- auditoría;
- operadores;
- sesiones;
- dispositivos;
- seguridad.

Si una operación legítima necesita una mutación nueva:

1. evaluar si debe ser Cloud Function;
2. validar cliente;
3. validar identidad;
4. validar operador;
5. validar permisos;
6. registrar auditoría cuando corresponda.

---

## 7. Autenticación del POS

El login del cliente final usa exclusivamente Google Sign-In.

Archivo principal:

`src/components/Login.jsx`

No agregar login por correo + contraseña al POS.

El Gmail utilizado debe corresponder con el cliente autorizado.

El flujo de licencia se controla principalmente mediante:

`src/hooks/useLicenseCheck.js`

Incluye:

- sesión Firebase;
- cliente;
- licencia;
- dispositivo;
- heartbeat/actualización de sesión;
- cierre de sesión;
- acceso offline controlado.

No duplicar listeners o heartbeats.

`App.jsx` mantiene deliberadamente una sola instancia de `useLicenseCheck()`.

---

## 8. Panel administrativo global

La ruta:

```text
/admin
```

usa un flujo separado.

Archivos principales:

- `src/components/AdminRoute.jsx`
- `src/components/AdminLogin.jsx`
- `src/components/AdminPanel.jsx`

La autorización del panel global comprueba el documento:

```text
admins/{uid}
```

No confundir:

- administrador global del proveedor;
- cliente/negocio;
- operador interno del comercio.

Son niveles de identidad distintos.

---

## 9. Operadores internos

El comercio dispone de operadores internos.

Archivo central:

`src/components/OperatorGate.jsx`

Roles actuales:

- `administrador`
- `encargado`

La sesión interna contiene identificador/token temporal y se valida mediante Cloud Functions.

No guardar ni propagar claves de operadores dentro de la sesión.

Mantener la separación entre:

- Firebase Auth;
- licencia/dispositivo;
- sesión de operador interno.

Las operaciones sensibles deben conservar el contexto del operador cuando actualmente lo requieren.

---

## 10. Hook central del POS

El estado operativo principal se coordina desde:

`src/hooks/usePosData.js`

Este hook administra, entre otras cosas:

- catálogo;
- ventas;
- sesiones de caja;
- cuentas por cobrar;
- lista de compras;
- cuentas por pagar;
- promociones;
- carrito;
- nombre del negocio;
- configuración de ticket;
- sincronización cloud;
- modo offline;
- cola offline;
- migración histórica.

Antes de modificar `usePosData.js`, revisar el impacto completo.

Es un archivo crítico.

No mover lógica fuera del hook únicamente por preferencia arquitectónica.

---

## 11. Servicios Cloud del POS

El acceso principal al backend operativo está centralizado en:

`src/services/pos/posFirestore.js`

No duplicar callables en componentes si ya existe un wrapper en este servicio.

Entre las operaciones actuales existen wrappers para:

- abrir caja;
- cerrar caja;
- registrar venta;
- convertir fondos;
- crear/editar/eliminar producto;
- reponer stock;
- eliminar cierre de caja;
- cuentas por cobrar;
- compras;
- cuentas por pagar;
- ganancias históricas;
- nombre del negocio;
- promociones.

Mantener validaciones y normalización de payloads.

---

## 12. Caja

La caja es un flujo crítico.

Debe mantenerse consistencia entre:

- caja abierta;
- operador;
- dispositivo;
- ventas;
- métodos de pago;
- movimientos;
- auditoría;
- cierre;
- historial.

No permitir:

- doble apertura accidental;
- doble cierre;
- doble checkout;
- duplicación de ventas;
- movimientos asociados a otra sesión;
- pérdida del `sessionId`;
- ventas fuera de la sesión incorrecta.

Respetar los locks/refs existentes en `usePosData.js` destinados a evitar operaciones duplicadas.

---

## 13. Ventas

El checkout es una operación crítica.

Antes de tocar venta o carrito revisar:

- producto por unidad;
- producto por peso;
- venta libre;
- promociones;
- stock;
- pagos;
- pagos mixtos;
- caja abierta;
- cuentas por cobrar;
- modo offline;
- sincronización posterior.

No asumir cantidades enteras.

No redondear pesos/cantidades de forma que altere el stock.

Evitar ejecuciones dobles de checkout.

---

## 14. Stock y tipos de producto

El POS soporta diferentes tipos de producto.

La lógica debe seguir siendo compatible con:

- unidades;
- peso/kg;
- venta libre.

No asumir que:

```text
cantidad === número entero
```

para todos los productos.

Respetar las funciones de normalización y redondeo existentes.

Antes de cambiar stock revisar tanto frontend como Cloud Functions.

---

## 15. Modo offline

El POS posee soporte offline real.

No tratarlo como una aplicación exclusivamente online.

Componentes relevantes:

- `src/lib/offlineAccess.js`
- `src/lib/offlineQueue.js`
- `src/lib/network.js`
- `src/components/OfflineStatusBar.jsx`
- `src/components/SyncCenterModal.jsx`
- `src/hooks/usePosData.js`

La cola offline usa IndexedDB.

Base actual:

```text
mi-negocio-pos-offline
```

Stores:

- `operations`
- `syncHistory`

Las ventas offline pueden quedar pendientes y sincronizarse después.

Cualquier cambio en ventas debe evaluar:

- qué ocurre sin red;
- qué se guarda localmente;
- qué stock se reserva/descuenta;
- cómo se reconcilia al volver la conexión;
- cómo se evitan duplicados.

No borrar ni reinicializar la cola offline como solución rápida.

---

## 16. PWA

La aplicación registra un Service Worker en producción.

Archivos relevantes:

- `src/lib/pwa.js`
- `public/sw.js`
- `public/manifest.webmanifest`

No romper:

- instalación;
- cache;
- actualización;
- funcionamiento offline;
- refresh de assets.

Después de cambios de PWA comprobar build de producción.

---

## 17. Migración histórica

Existe una migración de datos POS legacy a Firestore.

Archivo:

`src/services/pos/posMigration.js`

Callable backend:

`migrarPosLegacy`

Documento de control:

```text
clientes/{clienteId}/configuracion/migracion-pos-v1
```

No hacer que una migración ya procesada vuelva a importar datos.

No cambiar IDs históricos sin revisar deduplicación.

---

## 18. Auditoría

La auditoría es parte crítica del sistema.

Archivos:

- `src/services/pos/auditoriaFirestore.js`
- `src/pages/Actividad.jsx`
- `src/pages/Historial.jsx`
- Cloud Functions relacionadas

Eventos deben conservar:

- cliente;
- operador cuando corresponda;
- sesión de caja cuando corresponda;
- fecha;
- tipo;
- contexto suficiente.

El historial de una sesión puede cargar su auditoría mediante `sessionId`.

### PDF de auditoría

El PDF específico de auditorías debe contener únicamente la cronología completa de eventos de auditoría de esa sesión.

No duplicar:

- resumen económico;
- totales generales;
- contenido ya incluido en el archivo/PDF normal de Historial.

---

## 19. Historial

`src/pages/Historial.jsx` es una pantalla crítica y extensa.

Integra:

- sesiones de caja;
- ventas;
- detalle de sesión;
- auditoría;
- descarga de PDF;
- eliminación controlada de cierres.

No realizar refactors masivos en este archivo como parte de una corrección pequeña.

---

## 20. Compras y cuentas

El proyecto soporta:

- cuentas por cobrar;
- lista de compras;
- cuentas por pagar.

Archivos relevantes:

- `src/pages/CuentasPorCobrar.jsx`
- `src/pages/Compras.jsx`
- `src/services/pos/posFirestore.js`
- Cloud Functions correspondientes

No alterar saldos mediante cálculos sólo de UI.

Los cambios monetarios persistentes deben conservar la autoridad del backend.

---

## 21. Ganancias

Archivo principal:

`src/pages/Ganancias.jsx`

Existe soporte para migrar ganancias históricas.

No modificar fórmulas de ganancias sin estudiar:

- costos;
- cantidades;
- unidades/peso;
- ventas históricas;
- reglas de migración.

Evitar recomputaciones destructivas sobre datos históricos.

---

## 22. Promociones

Las promociones forman parte del catálogo/venta.

Archivos relacionados:

- `src/lib/promotions.js`
- `src/components/PromotionManagerModal.jsx`
- `src/components/PromotionSaleModal.jsx`
- `src/services/pos/posFirestore.js`
- `usePosData.js`

Cualquier cambio debe verificar:

- precio;
- stock de los productos incluidos;
- carrito;
- venta;
- offline;
- auditoría cuando corresponda.

---

## 23. Scanner

El escáner usa `html5-qrcode`.

Archivos relacionados:

- `src/components/Scanner.jsx`
- `src/pages/Vender.jsx`
- lógica de shortcuts/scanner en `App.jsx`

`App.jsx` contiene lógica deliberada para distinguir:

- teclas humanas;
- atajos de notebook;
- ráfagas de lector HID.

No simplificar timers o keyboard handlers sin revisar el comportamiento del lector físico.

---

## 24. Atajos desktop/notebook

`App.jsx` incluye accesos rápidos para:

- Numpad
- teclado de notebook

y protección para no dispararlos dentro de inputs o modales.

No reutilizar teclas sin revisar conflictos con:

- scanner HID;
- inputs;
- textarea;
- select;
- dialogs.

---

## 25. UI y sistema visual

La identidad visual central está en:

`src/index.css`

Tecnología:

- Tailwind CSS v4
- variables/tokens
- modo dark/light
- Liquid Glass
- adaptaciones desktop/mobile

Colores base actuales incluyen:

- fondo oscuro `#0B0D12`
- amarillo `#FFC61A`
- superficies oscuras
- variantes light

No introducir una paleta visual paralela sin necesidad.

Reutilizar clases y variables existentes antes de crear otras.

---

## 26. Tema claro/oscuro

El tema se aplica con:

```text
html[data-theme="light"]
html[data-theme="dark"]
```

La preferencia se persiste con:

```text
pos-theme
```

Todo nuevo componente visual importante debe revisarse en ambos temas.

No corregir sólo dark si rompe light.

---

## 27. Modos de efectos

`App.jsx` maneja modos de efectos visuales:

- complete
- balanced
- performance

Persistencia:

```text
pos-effects
```

No asumir que todos los usuarios utilizan efectos completos.

Los nuevos efectos deben degradarse razonablemente en modos de menor carga.

---

## 28. Responsive

Revisar como mínimo:

- móvil;
- notebook;
- desktop.

Breakpoint estructural importante existente:

```text
900px
```

En desktop hay comportamientos distintos, incluyendo panel lateral y ubicación del estado de caja.

No forzar que desktop y mobile tengan el mismo layout.

No romper BottomNav, MoreDrawer o paneles permanentes.

---

## 29. Modales y overlays

Mantener:

- `role="dialog"` cuando corresponda;
- `aria-modal="true"`;
- z-index coherente;
- scroll de fondo controlado;
- viewport móvil;
- accesibilidad de cierre.

`App.jsx` detecta dialogs bloqueantes para gestionar atajos.

No quitar atributos ARIA que sean utilizados también por lógica funcional.

---

## 30. Asistente IA

El proyecto posee asistente IA.

Archivos:

- `src/components/AiAssistant.jsx`
- `src/services/ai/assistantCloud.js`
- `src/services/ai/assistantContext.js`

Callable:

`consultarAsistenteIa`

El panel admin también dispone de configuración global del asistente.

No enviar secretos al frontend.

No ampliar contexto sensible sin revisar privacidad y necesidad.

---

## 31. ARCA

Existe un módulo ARCA.

Archivo:

`src/pages/Arca.jsx`

Usa Cloud Functions para leer/guardar configuración.

No implementar lógica fiscal sensible sólo en navegador.

No modificar comportamiento fiscal sin una solicitud explícita y validación suficiente.

---

## 32. Tickets y PDF

Archivos relevantes:

- `src/lib/pdf.js`
- `src/lib/saleTicket.js`
- `src/components/SaleTicketModal.jsx`
- `src/components/TicketSettingsModal.jsx`

Cambios en tickets/PDF deben verificar:

- datos monetarios;
- formatos;
- mobile;
- descarga;
- configuración existente.

No mezclar PDF de auditoría con el resumen económico de Historial.

---

## 33. Cloud Functions

Backend principal:

`functions/index.js`

Es un archivo crítico y extenso.

Antes de modificar una función:

1. localizar export exacto;
2. localizar clientes frontend;
3. revisar validación de auth;
4. revisar validación de cliente;
5. revisar dispositivo;
6. revisar operador/rol;
7. revisar transacciones/batches;
8. revisar auditoría;
9. revisar idempotencia;
10. ejecutar `npm run check` dentro de `functions`.

No refactorizar todo `functions/index.js` por una tarea pequeña.

---

## 34. Callables existentes

Antes de crear un callable nuevo, buscar uno existente.

El proyecto ya contiene callables para, entre otros:

### Sesiones/licencias/dispositivos

- `registrarSesion`
- `actualizarSesion`
- `cerrarSesionCliente`
- `listarDispositivos`
- `actualizarLimiteDispositivos`
- `cerrarSesionDispositivo`
- `cerrarTodasLasSesiones`

### Operadores

- `obtenerEstadoOperadores`
- `configurarAdministradorInicial`
- `listarOperadoresInternos`
- `iniciarSesionOperador`
- `validarSesionOperador`
- `cerrarSesionOperador`
- `recuperarAdministradorPrincipal`
- `crearOperadorInterno`
- `restablecerClaveOperadorInterno`

### POS

- `abrirCaja`
- `cerrarCaja`
- `registrarVenta`
- `convertirFondos`
- `crearProducto`
- `editarProducto`
- `eliminarProducto`
- `reponerStock`
- `eliminarCierreCaja`
- `crearCuentaPorCobrarManual`
- `registrarPagoCuentaPorCobrar`
- `cargarCompras`
- `crearItemCompra`
- `marcarItemCompraComprado`
- `crearCuentaPorPagarManual`
- `registrarPagoCuentaPorPagar`
- `migrarGananciasHistoricas`
- `guardarNombreNegocio`
- `listarPromociones`
- `guardarPromocion`
- `eliminarPromocion`
- `migrarPosLegacy`

### Otros

- configuración de ticket;
- configuración ARCA;
- configuración del asistente IA;
- administración global de clientes.

No duplicar endpoints sin necesidad.

---

## 35. Código crítico: política de cambios

Considerar de alto riesgo:

- `src/hooks/usePosData.js`
- `src/hooks/useLicenseCheck.js`
- `src/components/OperatorGate.jsx`
- `src/services/pos/posFirestore.js`
- `src/services/pos/posMigration.js`
- `functions/index.js`
- `firestore.rules`
- `src/pages/Vender.jsx`
- `src/pages/Caja.jsx`
- `src/pages/Historial.jsx`

Para cambios pequeños dentro de estos archivos:

- tocar lo mínimo;
- evitar reformateo global;
- evitar reordenar bloques no relacionados;
- validar referencias antes y después.

---

## 36. Git

El repositorio puede contener trabajo del usuario no relacionado.

Antes de cambios relevantes revisar:

```bash
git status
```

No ejecutar comandos destructivos como:

```bash
git reset --hard
git clean -fd
```

No descartar modificaciones existentes.

No hacer push, merge, rebase o deploy salvo solicitud explícita.

---

## 37. Dependencias

No instalar dependencias nuevas salvo necesidad real.

Antes:

1. buscar solución ya existente;
2. revisar si el proyecto ya posee una dependencia capaz;
3. justificar la incorporación;
4. evitar actualización masiva de paquetes.

No cambiar React, Vite, Firebase o Tailwind durante una tarea no relacionada.

---

## 38. Cambios visuales

Para una tarea visual:

1. identificar componente exacto;
2. revisar `index.css`;
3. revisar dark/light;
4. revisar mobile/desktop;
5. mantener funcionalidad;
6. no tocar Firebase innecesariamente.

Para un ajuste de CSS no refactorizar lógica de negocio.

---

## 39. Bugs

Para corregir un bug:

1. reproducir o identificar la causa;
2. seguir el flujo completo;
3. corregir la raíz;
4. validar escenarios vecinos;
5. evitar parches que sólo oculten síntomas.

Si el error es preexistente y no pertenece a la tarea, informarlo sin expandir arbitrariamente el alcance.

---

## 40. Integridad monetaria

Los importes deben tratarse con cuidado.

Revisar:

- `NaN`;
- strings;
- null/undefined;
- redondeo;
- pagos mixtos;
- efectivo;
- transferencia;
- QR;
- tarjeta;
- cuentas;
- costos;
- ganancias.

No confiar en valores enviados por UI sin validación backend en operaciones sensibles.

---

## 41. Idempotencia y dobles clics

El proyecto ya contiene protecciones contra dobles intentos en varias operaciones.

No eliminarlas.

En operaciones financieras o de stock nuevas, evaluar:

- doble click;
- reconexión;
- retry;
- refresh;
- offline replay;
- callable repetido.

Una misma acción no debe crear ventas o movimientos duplicados.

---

## 42. Acciones destructivas

Para eliminar:

- productos;
- cierres;
- clientes;
- operadores;
- otros datos importantes;

mantener confirmaciones, permisos y auditoría cuando corresponda.

No implementar cascadas destructivas sin analizar todas las referencias.

---

## 43. Cómo trabajar de forma autónoma

Antes de preguntar al usuario por un detalle técnico:

1. buscar en el repositorio;
2. revisar patrones existentes;
3. revisar componentes vecinos;
4. revisar Cloud Functions;
5. tomar la opción conservadora compatible con la implementación actual.

No pedir confirmación por decisiones menores que el código permite resolver.

Sí detenerse ante una decisión con impacto irreversible o de negocio no inferible.

---

## 44. Reporte final obligatorio

Al terminar, informar de forma breve:

### Cambios realizados

Qué comportamiento cambió.

### Archivos modificados

Sólo los archivos realmente alterados.

### Validación

Indicar el resultado real de:

```text
npm run check
```

y, si se modificó backend:

```text
cd functions
npm run check
```

### Pruebas manuales

Indicar únicamente las pruebas relacionadas con la tarea.

### Riesgos/observaciones

Sólo si existen.

No afirmar que algo fue validado si no se ejecutó.

---

## 45. Regla final

Antes de terminar cualquier tarea comprobar:

> ¿El cambio solicitado funciona sin debilitar seguridad, romper modo offline, alterar datos de otro cliente, duplicar ventas/movimientos o degradar una funcionalidad existente?

Si no puede responderse razonablemente que sí, continuar revisando.
