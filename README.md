# Question Paper Studio

Multi-tenant AI question paper generator: Super Admin creates organizations, each
organization admin uploads syllabus PDFs and generates exam papers, answer keys and
printable OMR sheets using Google Gemini.

## Stack
- **Frontend/Backend:** TanStack Start (React 19 + TypeScript, Vite) — server logic lives in
  `src/lib/*.functions.ts` server functions, so there is no separate backend process.
- **Database / Auth / Storage:** Supabase (SQL migrations in `supabase/migrations`)
- **AI:** Google Gemini (`GEMINI_API_KEY`), with an optional gateway fallback and a
  deterministic offline template generator used **only** when every AI call fails.
- **PDF parsing:** `pdfjs-dist` in the browser (no Python or native deps required).
- **Syllabus documents:** PDF and text extraction in the browser, with DOC/DOCX extraction
  through `word-extractor` on the server.

## Local setup (VS Code)
```bash
cp .env.example .env      # fill in GEMINI_API_KEY + Supabase values
npm install               # or: bun install
npm run dev               # http://localhost:8080
```

Apply the SQL in `supabase/migrations/` to your Supabase project (SQL editor or
`supabase db push`).

## First run
1. Open `/super-admin/bootstrap` and create the first Super Admin (works only while no
   super admin exists).
2. Sign in at `/super-admin/login`, create an organization + its admin.
3. Sign in as the org admin at `/`, change the password, then:
   - `/syllabi` — upload subject-wise syllabus / concept documents (PDF, DOC, DOCX and text formats;
     text is extracted in-browser or on the server as appropriate,
     chapters and keywords detected automatically)
   - `/templates` — NEET, JEE Main, JEE Advanced, EAMCET, CBSE 10/12, State Board, unit test
   - `/papers/new` — pick a pattern, question mix, negative marking, OMR toggle, generate
   - `/papers/:id` — question paper / answer key / OMR sheet, editable, print-to-PDF

## AI behaviour and logging
`src/lib/paper.functions.ts` logs every step to the server console:
`[AI] init …`, `[AI] Gemini request → …`, `[AI] Gemini response ← …`, duplicate removal,
provider failures with actionable messages (invalid key, quota, rate limit), and a clear
`[AI] all providers failed` warning when the offline fallback is used.

Generated MCQs are de-duplicated, marks are forced to the template's official values, and
the correct option is rotated evenly across A/B/C/D.

JEE Main uses separate MCQ and numerical-value sections. Standardized presets enforce their
blueprints server-side, while custom and unit-test presets retain flexible MCQ, numerical,
short-answer, and long-answer mixes. SuperAdmins can configure global paper and active-admin
limits from the platform dashboard.

## Build & deploy
```bash
npm run build
```
Deployable to Vercel, Render or any Node/edge host that runs a Vite/Nitro output.
Set the same environment variables in the host's dashboard.

## Scripts
| Command | Purpose |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run lint` | eslint |
| `npm run format` | prettier |
