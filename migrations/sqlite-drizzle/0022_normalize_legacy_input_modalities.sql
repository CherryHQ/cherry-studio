-- The old add-model form stored `[]` for "no input modality chosen". Under the delta contract
-- `[]` means "explicitly cleared", so those rows move to NULL (inherit) — every later `[]` was
-- written with the provenance bit set and keeps its meaning. Representation only: no semantics.
UPDATE `user_model`
SET `input_modalities` = NULL
WHERE `input_modalities` = '[]'
  AND `input_modalities_explicit` = 0;
