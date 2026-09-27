-- Create the storage buckets referenced by the application and storage policies.
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('syllabus-pdfs', 'syllabus-pdfs', false),
  ('generated-papers', 'generated-papers', false),
  ('org-logos', 'org-logos', false)
ON CONFLICT (id) DO NOTHING;
