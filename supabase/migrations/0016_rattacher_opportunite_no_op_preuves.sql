-- supabase/migrations/0016_rattacher_opportunite_no_op_preuves.sql
-- Fix: the "closed, no real trigger" branch (statut in reussie/abandonnee/refusee
-- and not p_declencheur_reel) is meant to leave the opportunity completely untouched,
-- but the preuves-diff/sync block ran unconditionally after the if/elsif chain,
-- so it could still insert preuve_ajoutee/preuve_retiree events and mutate
-- opportunite_promos_preuves for a closed opportunity. Gate that block on a flag
-- set only in that branch.
create or replace function rattacher_opportunite(
  p_magasin_id uuid,
  p_produit_canonique_id uuid,
  p_type_mission text,
  p_promo_id uuid,
  p_niveau_priorite text,
  p_score integer,
  p_confiance text,
  p_raisons jsonb,
  p_fingerprint text,
  p_version_moteur text,
  p_declencheur_reel boolean,
  p_preuves_promo_ids uuid[],
  p_visite_id uuid default null
) returns opportunites as $$
declare
  v_id uuid;
  v_ancien_fingerprint text;
  v_ancien_statut text;
  v_opportunite opportunites;
  v_pas_de_changement boolean := false;
begin
  select id, fingerprint, statut into v_id, v_ancien_fingerprint, v_ancien_statut
  from opportunites
  where magasin_id = p_magasin_id
    and produit_canonique_id = p_produit_canonique_id
    and type_mission = p_type_mission
    and (promo_id = p_promo_id or (promo_id is null and p_promo_id is null))
  for update;

  if v_id is null then
    insert into opportunites (
      magasin_id, produit_canonique_id, type_mission, promo_id,
      niveau_priorite, score, confiance, raisons_actuelles, score_calcule_at, fingerprint, version_moteur
    ) values (
      p_magasin_id, p_produit_canonique_id, p_type_mission, p_promo_id,
      p_niveau_priorite, p_score, p_confiance, p_raisons, now(), p_fingerprint, p_version_moteur
    ) returning * into v_opportunite;

    insert into opportunite_evenements (opportunite_id, type, visite_id, score_a_ce_moment, raisons, statut_apres)
    values (v_opportunite.id, 'creation', p_visite_id, p_score, p_raisons, v_opportunite.statut);

  elsif v_ancien_statut in ('reussie', 'abandonnee', 'refusee') and not p_declencheur_reel then
    select * into v_opportunite from opportunites where id = v_id;
    v_pas_de_changement := true;

  elsif v_ancien_statut in ('reussie', 'abandonnee') or (v_ancien_statut = 'refusee' and p_declencheur_reel) then
    update opportunites set
      statut = 'detectee', niveau_priorite = p_niveau_priorite, score = p_score, confiance = p_confiance,
      raisons_actuelles = p_raisons, score_calcule_at = now(), fingerprint = p_fingerprint,
      version_moteur = p_version_moteur, cycle = cycle + 1, derniere_reouverture_at = now(), cloture_at = null
    where id = v_id
    returning * into v_opportunite;

    insert into opportunite_evenements (opportunite_id, type, visite_id, score_a_ce_moment, raisons, statut_avant, statut_apres)
    values (v_id, 'reouverture', p_visite_id, p_score, p_raisons, v_ancien_statut, 'detectee');

  elsif v_ancien_fingerprint is distinct from p_fingerprint then
    update opportunites set
      niveau_priorite = p_niveau_priorite, score = p_score, confiance = p_confiance,
      raisons_actuelles = p_raisons, score_calcule_at = now(), fingerprint = p_fingerprint, version_moteur = p_version_moteur
    where id = v_id
    returning * into v_opportunite;

    insert into opportunite_evenements (opportunite_id, type, visite_id, score_a_ce_moment, raisons, statut_avant, statut_apres)
    values (v_id, 'recalcul_score', p_visite_id, p_score, p_raisons, v_ancien_statut, v_opportunite.statut);

  else
    update opportunites set score_calcule_at = now() where id = v_id returning * into v_opportunite;
  end if;

  if not v_pas_de_changement then
    with actuelles as (
      select promo_id from opportunite_promos_preuves where opportunite_id = v_opportunite.id
    ),
    cible as (
      select unnest(coalesce(p_preuves_promo_ids, array[]::uuid[])) as promo_id
    ),
    ajouts as (select promo_id from cible except select promo_id from actuelles),
    retraits as (select promo_id from actuelles except select promo_id from cible)
    insert into opportunite_evenements (opportunite_id, type, visite_id, raisons)
    select v_opportunite.id, 'preuve_ajoutee', p_visite_id, jsonb_build_object('promo_id', promo_id) from ajouts
    union all
    select v_opportunite.id, 'preuve_retiree', p_visite_id, jsonb_build_object('promo_id', promo_id) from retraits;

    delete from opportunite_promos_preuves
    where opportunite_id = v_opportunite.id
      and promo_id != all(coalesce(p_preuves_promo_ids, array[]::uuid[]));

    insert into opportunite_promos_preuves (opportunite_id, promo_id)
    select v_opportunite.id, unnest(coalesce(p_preuves_promo_ids, array[]::uuid[]))
    on conflict (opportunite_id, promo_id) do nothing;
  end if;

  return v_opportunite;
end;
$$ language plpgsql security definer set search_path = public;
