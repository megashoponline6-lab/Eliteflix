# Éliteflix (Express + EJS + Tailwind)

Proyecto base listo para Render (Node 20).

## Requisitos
- Node 20.x
- (Render Free compatible)

## Scripts
- `npm run build:css`  → compila Tailwind a `public/css/output.css`
- `npm run dev:css`    → compila en modo watch
- `npm start`          → inicia el server

## Deploy en Render
- Build Command: `npm install && npm run build:css`
- Start Command: `npm start`
- Root Directory: `.`

## Primer uso (setup admin)
1. Abre `/admin/setup` y crea tu usuario administrador.
2. Esa ruta quedará bloqueada automáticamente.
3. Luego ingresa a `/admin/login`.
