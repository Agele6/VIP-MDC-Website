# VIP MDC Predictions

Node.js + Express + SQLite (file database, no server to install).

## Run
```
npm install
cp .env.example .env     # then set ADMIN_PASSWORD
npm start
```
Site: http://localhost:3000  ·  Admin: http://localhost:3000/admin

## Folders
- `server.js` – API and static hosting
- `db/database.js` – schema, seed packages; database file `db/vipmdc.sqlite` is created on first run (back it up)
- `public/` – website (`index.html`, `css/`, `js/`) and `admin/`

## Workflow
1. Admin → Settings: add your WhatsApp number (e.g. 2348012345678) and bank details.
2. Customer submits the Subscribe form and sends payment proof on WhatsApp.
3. Admin → Subscribers → Approve: an access code is generated. Send it to the customer.
4. Admin → Predictions: add tips. "Everyone" = free tips on the homepage; tiers show only to matching packages and above in the VIP Room.

## Deploy
Any Node host with a persistent disk (VPS, Render with disk, Railway volume). Put HTTPS in front (nginx/Caddy). Set `ADMIN_PASSWORD` and `PORT`.
