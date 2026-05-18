# Railway Deployment Checklist

## Required fixes (already applied)

1. **Bind to 0.0.0.0** – Server listens on `0.0.0.0:PORT` so Railway can route traffic
2. **Start script** – Uses `node server.js` (not nodemon) for production
3. **SMTP** – Skipped in production to avoid startup failure
4. **Env validation** – Fails fast if required vars are missing

## Railway Settings

### Root directory
Set to `backend` if you deploy from the repo root.

### Build
```
npm install
```

### Start
```
npm start
```

### Environment variables (required in production)

| Variable | Description |
|----------|-------------|
| `PORT` | Set by Railway automatically |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `JWT_SECRET` | Strong secret for auth tokens |
| `FRONTEND_URL` | Your frontend URL (for CORS) |

### Domain

Railway → Settings → Domains: ensure a domain is bound. If `backend-production-8d0b.up.railway.app` is gone, generate a new one.

## Logs to verify

After deploy, check Railway logs for:

```
Server listening on 0.0.0.0:XXXXX
database connected ✅
supabase storage connected ✅
smtp skipped (production)
```

If you see `Startup failed:` or `Missing required env vars:`, fix the env vars and redeploy.
