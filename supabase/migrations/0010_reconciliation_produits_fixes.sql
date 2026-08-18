-- Fixes de revue pour la migration 0009 (reconciliation_produits) :
-- 1. La contrainte typologie_check (0006, NOT VALID) rejette toute nouvelle
--    valeur hors 'obligatoire'/'picking' — ça bloque les codes réels du plan
--    de vente (T1, H2, MN...) que la tâche 6 doit pouvoir écrire. On la
--    retire : la réconciliation des valeurs de typologie est portée par ce
--    sous-projet, pas par une contrainte figée sur l'ancien schéma.
alter table produits_enseigne drop constraint produits_enseigne_typologie_check;

-- 2. verifier_produit_canonique() doit suivre la convention du projet pour
--    les fonctions de trigger/RLS (voir 0001_schema_and_rls.sql) : security
--    definer + search_path fixé, sinon l'advisor sécurité Supabase le
--    signale (function_search_path_mutable). Même corps, juste la signature.
--
-- Bloque, au moment de l'écriture : l'auto-référence directe, et le
-- rattachement à une ligne qui est elle-même déjà une variante (son
-- produit_canonique_id n'est pas null). Ce n'est pas une invariante
-- permanente : la vérification ne porte que sur la ligne en cours
-- d'écriture, donc un canonique re-parenté plus tard vers un autre
-- canonique pourrait faire apparaître une chaîne sans être détecté.
-- Limitation connue et acceptée — aucune tâche de ce plan ne re-parente un
-- produit déjà canonique, et aucune vérification récursive n'est ajoutée.
create or replace function verifier_produit_canonique() returns trigger as $$
begin
  if new.produit_canonique_id is not null then
    if new.produit_canonique_id = new.id then
      raise exception 'Un produit ne peut pas être son propre canonique';
    end if;
    if exists (
      select 1 from produits
      where id = new.produit_canonique_id and produit_canonique_id is not null
    ) then
      raise exception 'Le produit canonique référencé (%) est lui-même une variante — pas de chaînage', new.produit_canonique_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
