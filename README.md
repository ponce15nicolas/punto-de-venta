# Caja & Stock — Punto de venta

App de punto de venta hecha con **Vite + React**, estilos en **Tailwind CSS v4**
y animaciones con **motion** (Framer Motion).

## Funciones

- **Vender**: escaneo de código de barras con la cámara (o ingreso manual), ticket
  tipo comprobante, cobro que descuenta stock automáticamente.
- **Stock**: alta/edición/eliminación de productos con precio, stock y fecha de
  vencimiento. Avisos de stock bajo y productos por vencer.
- **Caja**: apertura con monto inicial, seguimiento de ventas del turno, cierre
  comparando efectivo esperado vs. contado.
- **Historial**: turnos de caja cerrados con su resumen.

## Cómo correrla

```bash
npm install
npm run dev       # entorno de desarrollo
npm run build     # genera la carpeta dist/ lista para publicar
npm run preview   # sirve la build de producción localmente
```

Requiere Node 18+.

## Sobre los datos (importante)

Esta versión guarda todo en **localStorage**, es decir, en el navegador de
**ese dispositivo**. Si abrís la app en el celular y en una computadora, cada
uno va a tener su propio stock y sus propias ventas — no se sincronizan solas.

Para un solo dispositivo (una caja, un celular) esto alcanza perfectamente.
Si necesitás que varias cajas o empleados compartan el mismo stock y las
mismas ventas en tiempo real, hay que sumar un backend (por ejemplo Firebase
o Supabase) que reemplace `src/lib/storage.js`. Avisame si querés que lo
armemos.

## Cámara y escaneo

El escaneo usa `html5-qrcode` y la cámara trasera del dispositivo
(`facingMode: "environment"`). Necesita:

- Que el sitio se sirva por **HTTPS** (o `localhost` en desarrollo) — los
  navegadores bloquean la cámara en HTTP.
- Que el usuario acepte el permiso de cámara la primera vez.

Si la cámara no está disponible, siempre se puede escribir el código a mano.

## Publicar la app

`npm run build` genera `dist/`, que podés subir a cualquier hosting estático:
Vercel, Netlify, GitHub Pages, Cloudflare Pages, etc. Recordá que necesita
HTTPS para que funcione el escaneo por cámara.
