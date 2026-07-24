
CREATE POLICY "token media readable by all"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'token-media');

CREATE POLICY "authenticated can upload token media to own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'token-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "authenticated can update own token media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'token-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "authenticated can delete own token media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'token-media' AND auth.uid()::text = (storage.foldername(name))[1]);
