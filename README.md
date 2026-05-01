# Grocery Shop Manager

A full-stack grocery shop management app for handling stock, pricing, billing, sales history, and credit (khata/udhaar) accounts.

## Features

- User authentication with JWT (register, login, profile, password change/reset)
- Admin controls for user management
- Inventory management (add items, update stock, update prices)
- Billing with sale line items
- Daily sales summary and bill history
- Credit account (udhaar/khata) tracking
- PWA support (`manifest.json`, service worker)

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js, Express
- Database: PostgreSQL (`pg`)
- Auth/Security: `jsonwebtoken`, `bcrypt`

## Project Structure

- `index.html` - main app UI
- `admin.html` - admin panel UI
- `dashboard.html` - dashboard UI
- `js/` - frontend logic
- `css/` - stylesheets
- `backend/server.js` - Express API and static hosting
- `backend/db.js` - PostgreSQL connection and table initialization
- `render.yaml` - Render deployment config

## Prerequisites

- Node.js 18+
- npm
- PostgreSQL database (or hosted PostgreSQL URL)

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/<your-username>/Grocery-Shop-Manager.git
   cd Grocery-Shop-Manager
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `backend/.env` file:
   ```env
   PORT=4000
   HOST=0.0.0.0
   JWT_SECRET=your-strong-secret
   DATABASE_URL=postgres://username:password@host:5432/database_name
   ```

4. Start the app:
   ```bash
   npm start
   ```

5. Open in browser:
   - `http://localhost:4000`

## Deployment (Render)

This project already includes `render.yaml` for one-click style setup on Render:

- Web service: `grocery-shop-manager`
- Start command: `npm start`
- Database: managed PostgreSQL (`grocery-db`)
- Required env vars: `JWT_SECRET`, `DATABASE_URL`

## Screenshots

Add screenshots to `assets/screenshots/` using the file names below:

- `assets/screenshots/login.png`
- `assets/screenshots/dashboard.png`
- `assets/screenshots/billing.png`
- `assets/screenshots/admin.png`

Then they will appear in this section on GitHub:

### Login
![Login Screen](assets/screenshots/login.png)

### Dashboard
![Dashboard](assets/screenshots/dashboard.png)

### Billing
![Billing](assets/screenshots/billing.png)

### Admin Panel
![Admin Panel](assets/screenshots/admin.png)

## Notes

- On first run, database tables are auto-created by `backend/db.js`.
- For remote/mobile access tips, see `backend/REMOTE-ACCESS.txt`.

## License

This project is currently unlicensed. Add a `LICENSE` file if you want to make usage terms explicit.