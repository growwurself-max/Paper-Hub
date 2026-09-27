# Question Paper Studio - Self-Hosted Setup Guide

This application has been fully cleaned of Lovable dependencies and is now a self-hosted, open-source application.

## Prerequisites

- Node.js 18+ 
- A Supabase project (free tier works)
- (Optional) Google Gemini API key for AI-powered question generation

## Setup Instructions

### 1. Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and create a free account
2. Create a new project
3. Wait for the project to be ready (2-3 minutes)
4. Go to Project Settings > API
5. Copy the following values:
   - Project URL
   - anon/public key (SUPABASE_PUBLISHABLE_KEY)
   - service_role key (SUPABASE_SERVICE_ROLE_KEY)

### 2. Configure Environment Variables

Fill in the `.env` file with your Supabase credentials:

```env
# Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Same values for Vite (client-side)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here

# Optional: Google Gemini API for AI question generation
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Apply Database Migrations

Go to your Supabase project dashboard:

1. Navigate to SQL Editor
2. Run each migration file in order from `supabase/migrations/`:
   - `20260728121100_d9528409-5a3e-4323-893c-c19e560c12a5.sql`
   - `20260728121230_1faa27ec-5eca-4b78-9411-e37f95b61c3c.sql`
   - `20260728121257_d75f0c82-61da-4d30-8f6f-933786537f92.sql`
   - `20260925000000_seed_test_users.sql`
   - `20260925010000_create_storage_buckets.sql`
   - `20260925020000_create_platform_settings.sql`
   - `20260925030000_add_syllabus_subject.sql`
   - `20260925040000_add_institute_paper_quotas.sql`

### 4. Seed Test Users

Run the seed script to create test accounts:

```bash
npm run seed:test-users
```

This will create:
- **Super Admin**: the value of `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`
- **College Admin**: the value of `SEED_COLLEGE_ADMIN_EMAIL` / `SEED_COLLEGE_ADMIN_PASSWORD`

Add the four `SEED_*` values to `.env` before running the script — it exits with an
error if they are missing. Never commit real credentials.

### 5. Start the Application

```bash
npm run dev
```

The app will be available at `http://localhost:8080`

## Test Credentials

### Super Admin
- **Email**: value of `SEED_SUPER_ADMIN_EMAIL`
- **Password**: value of `SEED_SUPER_ADMIN_PASSWORD`
- **Login URL**: `/super-admin/login`
- **Capabilities**: Create organizations, manage platform settings

### College Admin
- **Email**: value of `SEED_COLLEGE_ADMIN_EMAIL`
- **Password**: value of `SEED_COLLEGE_ADMIN_PASSWORD`
- **Login URL**: `/` (institution login)
- **Capabilities**: Manage syllabi, templates, generate papers

## Application Structure

- `/super-admin/login` - Platform administration login
- `/super-admin/bootstrap` - Initial setup (only if no super admin exists)
- `/` - Institution (organization) login
- `/syllabi` - Upload and manage subject-tagged syllabus files (`.pdf`, `.doc`, `.docx`, `.txt`, `.md`, `.csv`, `.rtf`)
- `/templates` - Create exam paper templates
- `/papers/new` - Generate new question papers
- `/papers/:id` - View and edit generated papers

## Features

- Multi-tenant architecture with organization isolation
- Role-based access control (Super Admin, Org Admin)
- AI-powered question generation (via Google Gemini)
- Offline fallback for question generation
- PDF syllabus processing with text extraction
- Automatic chapter and keyword detection
- Multiple exam pattern templates (NEET, JEE, CBSE, etc.)
- JEE Main blueprints with 20 MCQs and 10 numerical value questions per subject
- Subject-aware syllabus filtering and strict source-content matching
- Printable question papers, answer keys, and OMR sheets
- Daily AI quota management per organization
- SuperAdmin global daily paper and active college-admin limits

## Troubleshooting

### Missing Supabase Environment Variables
If you see "Missing Supabase environment variable(s)" error:
- Ensure `.env` file exists in the project root
- Check that all required variables are set
- Restart the dev server after updating `.env`

### Database Connection Issues
- Verify your Supabase project is active
- Check that the API URL and keys are correct
- Ensure database migrations have been applied

### Seed Script Fails
- Verify SUPABASE_SERVICE_ROLE_KEY is correct
- Ensure you have service role permissions
- Check that the test organization doesn't already exist

### Subject Syllabus Uploads
- Enter the subject before selecting a file.
- Word documents are extracted server-side; PDF and text formats are parsed during upload.
- The paper form filters source documents by the selected subject and rejects mismatches.

### Platform Limits
- SuperAdmin dashboard > Platform safeguards controls global daily paper generation and active college-admin limits.
- Enter `0` for unlimited. Apply `20260925020000_create_platform_settings.sql` before using the panel.

### Institute Paper Credits and Limits
- Apply `20260925040000_add_institute_paper_quotas.sql` after the base migrations.
- SuperAdmin > Organizations controls each institute's remaining paper credits and daily paper limit.
- Leave paper credits blank for unlimited credits. Enter `0` for an unlimited daily paper limit.
- If Supabase reports that `platform_settings` is missing from the schema cache, run the migration and execute `NOTIFY pgrst, 'reload schema';` in the SQL Editor.

### Institute Credit Quota Editor
- Apply `20260925050000_create_exams_results_and_credit_ledger.sql` after `20260925040000`.
- SuperAdmin > Credits (`/super-admin/credits`) is the quota editor: top up a bundle relatively, or assign an exact balance, with a per-institute movement history.
- Institutes are the same rows as SuperAdmin > Organizations. "Unlimited" means `paper_credit_balance IS NULL`; a top up is rejected on an unlimited institute, so switch it to a finite balance first.
- Every balance change writes an append-only row to `credit_transactions`, including the automatic debit and refund performed during paper generation. Transitions to or from unlimited are recorded in `audit_logs` instead, because they have no finite balance.
- This migration also creates the ResultHub `exams` and `exam_results` tables and backfills one `exams` row per existing generated paper. `exam_results.status` moves through `pending` → `processing` → `verified` → `published`, and the table rejects publishing without a `published_at` timestamp.

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Run linter
npm run lint

# Format code
npm run format

# Seed test users
npm run seed:test-users
```

## Security Notes

- Never commit the `.env` file or real API keys
- The service role key should only be used server-side
- Test credentials are for development only - change them in production
- The app uses Supabase Row Level Security (RLS) for data isolation

## License

This is a self-hosted application with no external dependencies on proprietary platforms.