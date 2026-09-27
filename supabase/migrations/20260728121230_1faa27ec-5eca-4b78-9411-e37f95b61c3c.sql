
-- Files are stored under `${organization_id}/...`. First path segment is the org id.

CREATE POLICY "org files select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('syllabus-pdfs','generated-papers','org-logos')
  AND (
    public.is_super_admin()
    OR (storage.foldername(name))[1] = public.current_org_id()::text
  )
);

CREATE POLICY "org files insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('syllabus-pdfs','generated-papers','org-logos')
  AND (
    public.is_super_admin()
    OR (storage.foldername(name))[1] = public.current_org_id()::text
  )
);

CREATE POLICY "org files update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('syllabus-pdfs','generated-papers','org-logos')
  AND (
    public.is_super_admin()
    OR (storage.foldername(name))[1] = public.current_org_id()::text
  )
);

CREATE POLICY "org files delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('syllabus-pdfs','generated-papers','org-logos')
  AND (
    public.is_super_admin()
    OR (storage.foldername(name))[1] = public.current_org_id()::text
  )
);
