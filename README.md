# SwipeSurvey AI

A fun, swipe-based survey system for creating and taking MCQ surveys.

## What it does

- Creator signup/login
- AI survey builder from a plain-English prompt
- Manual survey builder and editor
- Public swipe survey link
- Swipe left / right / up / down, plus keyboard arrows
- Response storage
- Creator dashboard with stats, answer breakdowns, and CSV export
- Works without an AI key using a built-in fallback generator

## Tech stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Storage: local JSON file, so it runs anywhere without database setup
- AI: OpenAI Responses API when `OPENAI_API_KEY` is set

## Quick start

```bash
cd swipe-survey-ai
npm install
npm run install:all
cp server/.env.example server/.env
npm run dev
```

Open:

- App: http://localhost:5173
- API: http://localhost:8787

## Add AI generation

Edit `server/.env`:

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4.1-mini
```

Restart the dev server.

## Production build

```bash
npm run build
npm --prefix server start
```

Then open http://localhost:8787

## How to use

1. Sign up as a survey creator.
2. Click **New survey**.
3. Type the type of survey you want, for example: `Build a 10-question survey for an NFC medical ID startup.`
4. Generate with AI or start from the sample.
5. Edit questions and answer options.
6. Save and copy the public survey link.
7. Share the link with respondents.
8. View stats from the dashboard.

## Notes

This is an MVP. For production, replace the JSON file with Postgres/Firebase/Supabase, add email verification, stronger rate-limits, and a hosted file/database backup strategy.
