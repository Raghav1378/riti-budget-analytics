# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:


## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

# Rajasthan Budget Intelligence

React/Vite frontend and Node API for the budget dashboard, local cost estimation, PDF retrieval, and streamed Gemini explanations.

## Local Development

```powershell
Copy-Item .env.example .env
# Edit .env and set GEMINI_API_KEY.
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the Node API on port `8787`.

## Production

Run from this directory:

```powershell
npm ci
npm run lint
npm run build
node --check server.mjs
npm start
```

The Node server serves `dist` and the API from one origin. Configure these in the hosting provider, never in frontend code or GitHub:

```env
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL=gemini-3-flash-preview
PORT=8787
DATA_DIR=/app/data
ALLOWED_ORIGIN=https://your-public-domain.example
```

`DATA_DIR` must contain the source PDFs. The current PDFs total about 71 MB and currently live in the parent workspace at `Fullstack/data`. To make this repository self-contained, copy them into the app before pushing:

```powershell
Copy-Item ..\data .\data -Recurse
```

Alternatively, keep them outside GitHub and mount/download them during deployment. Do not commit `.env`.

## GitHub Push

Initialize Git in `budget-demo`, not the parent `Fullstack` folder:

```powershell
Set-Location .\budget-demo
git init
git add .
git status
git commit -m "Initial budget intelligence app"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPO.git
git push -u origin main
```

The existing `.gitignore` excludes `.env`, `node_modules`, and `dist`. Push `.env.example`, never `.env`. If the PDFs are not in the repository, provide them through private storage or a mounted volume and set `DATA_DIR`.

## Release Checklist

- `npm ci` completes.
- `npm run lint` passes.
- `npm run build` passes.
- `node --check server.mjs` passes.
- `dist/index.html` exists after the build.
- `GET /api/status` reports indexed source passages.
- `POST /api/ask/stream` returns `text/event-stream`.
- The Gemini key exists only in hosting environment variables.
- `ALLOWED_ORIGIN` matches the public site.
- Deployment contains the PDFs referenced by `DATA_DIR`.
