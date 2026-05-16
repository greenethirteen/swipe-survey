# Project structure

```txt
swipe-survey-ai/
  client/
    src/
      main.jsx        # React app, routes, builder, dashboard, swipe UI
      styles.css      # Full responsive UI styling
    index.html
    package.json
  server/
    data/db.json      # Local JSON database
    index.js          # Express API, auth, AI generation, stats, CSV export
    .env.example
    package.json
  README.md
  package.json
```

## Main API routes

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/ai/survey`
- `GET /api/surveys`
- `POST /api/surveys`
- `GET /api/surveys/:id/stats`
- `GET /api/surveys/:id/export.csv`
- `GET /api/s/:slug`
- `POST /api/s/:slug/responses`
```
