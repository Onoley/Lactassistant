-- statuts_produit_magasin_historique was created in 0011 with SELECT and INSERT
-- policies only. The idempotent upsert in updateStatutProduit (Task 5, keyed on
-- magasin_id, produit_id, visite_id) needs UPDATE privilege under RLS for its
-- ON CONFLICT DO UPDATE branch — without it, the second write to the same key
-- is rejected, defeating the idempotence this table exists for.
create policy "statuts_historique_update_own_secteur" on statuts_produit_magasin_historique for update
  using (
    (select role from current_profile()) = 'admin'
    or ((select role from current_profile()) = 'commercial'
        and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile())))
  );
