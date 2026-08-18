# Réconciliation produits / assortiment / typologie — Design

## Contexte

Les promos référencent parfois un EAN de conditionnement promotionnel (ex. `La Laitière FDM chocolat 3x57g +1 offert`) distinct de l'EAN vendable normal (`La Laitiere Feuillete De Mousse Chocolat x4 57g`) pour le même produit réel. Aujourd'hui l'app traite ces deux lignes `produits` comme deux produits indépendants : le rep ne peut signaler une absence que contre l'EAN vendable, donc une promo qui référence l'EAN promotionnel ne déclenche jamais correctement, et l'assortiment (`produits_enseigne`) est incomplet/incohérent (45% des produits référencés dans des promos n'avaient aucune ligne d'assortiment).

L'utilisateur a fourni des fichiers Excel construits à la main à partir des vrais plans de vente LNUF par enseigne (Auchan, Carrefour, Carrefour Market, Intermarché, Leclerc, Système U) : liste exhaustive des EAN vendables par enseigne, avec famille/segment, et pour 3 enseignes (Auchan, Carrefour, Carrefour Market) une colonne typologie (T1-T6, H1-H4, MN, MD, Région).

## Résultat fonctionnel attendu

L'assortiment d'un magasin ne doit contenir **que** les références vendables présentes dans le plan de vente de son enseigne. Volumes de référence attendus après import :

| Enseigne | Références |
|---|---|
| Auchan | 120 |
| Carrefour | 123 |
| Carrefour Market | 85 |
| Intermarché | 103 |
| Leclerc | 156 |
| Système U | 100 |

Les EAN promotionnels, OD, anciens packs et conditionnements « + offerts » ne doivent plus jamais apparaître comme lignes indépendantes de l'assortiment, sauf s'ils figurent réellement dans le plan de vente de l'enseigne. Ils restent dans `produits` et dans les opérations promotionnelles, mais ne polluent plus la liste permanente. Un produit hors plan de vente et sans correspondance canonique reste en base avec un statut explicite (`a_qualifier` par défaut — voir Modèle de données) plutôt que d'être traité silencieusement comme un produit permanent.

Cette règle s'applique aux 6 enseignes sans exception, et devra s'appliquer automatiquement à toute enseigne importée à l'avenir.

## Ce qui est confirmé (vérifié contre les données réelles)

- **159 EAN listés dans les plans de vente existent déjà tous dans `produits`** — aucune création de produit nécessaire.
- **76 produits n'apparaissent sur aucun plan de vente.** Après recoupement (abréviations FDM/RAL/SAL/PPC/YPV/VDC/YAF PAT, format de conditionnement, et les précisions métier de l'utilisateur) : **60 se rattachent avec confiance** à un produit canonique, **16 restent `a_qualifier`** — détail complet dans "Rapport de correspondances canoniques" plus bas. Deux propositions initiales de l'utilisateur (Yaos café → `3023290096895`, Yaos pistache → `3023290093542`) ont été vérifiées contre la base et **rejetées** : ces EAN cibles correspondent en réalité à Siggis Myrtille et La Laitiere Mangue, pas aux produits Yaos décrits — coquilles de saisie. L'utilisateur a fourni les bons EAN (Yaos pistache → `3023290091555` "Nestle Yaos Brasse Chaud Pistache", Yaos café → `3023290096475` "Nestle Yaos Brasse Chaud Cafe"), vérifiés et confirmés — mon algorithme ne les avait pas trouvés car le nom canonique réel porte un qualificatif "Brasse Chaud" non anticipé. Un lien initialement proposé par mon propre algorithme (`Lindahls Pro + Stracciatella` x1 330g → x2 160g) a été retiré après vérification : les deux noms sont identiques mais **aucun marqueur promotionnel** (ni `OD` ni `+N offert`) ne figure sur le premier — les deux formats sont vraisemblablement des références permanentes distinctes (même logique que Flanby x6/x12), pas une variante promo d'emballage.
- **La typologie T1-T6/H1-H4/MN/MD/Région est réelle**, propre à chaque enseigne. MN = "module nature", MD = "module dessert" : des modules que le magasin active ou non (pas un niveau de priorité). T1/T2.../H1/H2... : le magasin se déclare lui-même à un niveau par famille/segment (donnée non encore collectée — Phase 2), et tout produit à ce niveau ou en-dessous est attendu, le reste est du picking.
- **1 signalement réel** (`statuts_produit_magasin`) existe contre un EAN promotionnel (`La Laitière RAL nature sur lit de caramel 4x115g +2 offerts`, magasin Auchan La Défense, manquant) — ce cas historique est récupéré par résolution à la lecture ; tous les signalements futurs sont normalisés dès l'écriture (voir "Résolution à la lecture et à l'écriture").
- **0 lignes `priorites_produits`** (Top 20/50/70) ne référencent un EAN promotionnel.

## Portée : Phase 1 (cette spec) vs Phase 2 (plus tard)

**Phase 1** : identité produit, assortiment, typologie brute, affichage, priorités groupées.

**Phase 2** (hors scope) : déclaration de typologie par magasin (par famille/segment), modules MN/MD activables par magasin, recalcul du flag obligatoire/picking par comparaison magasin↔produit.

## Modèle de données

```sql
alter table produits add column produit_canonique_id uuid references produits(id);
alter table produits add column famille text;
alter table produits add column segment text;
alter table produits add column statut_catalogue text not null default 'permanent';
-- statut_catalogue: 'permanent' (sur un plan de vente actuel), 'a_qualifier'
-- (hors plan de vente, pas de correspondance fiable — défaut pour tout produit
-- créé hors import plan de vente), 'variante_promo' (produit_canonique_id
-- renseigné), 'arrete' (retiré manuellement par un admin).

create index idx_produits_canonique on produits(produit_canonique_id);

alter table produits add column type_liaison text
  check (type_liaison in ('conditionnement_promo', 'ancien_ean', 'repackaging'));

-- Un produit canonique ne peut pas lui-même pointer vers un autre produit ;
-- empêche l'auto-référence et les chaînes/boucles par construction (si B
-- pointe vers A, A doit avoir produit_canonique_id null — donc A ne peut pas
-- pointer vers B, et aucune chaîne de plus d'un niveau n'est possible).
create or replace function verifier_produit_canonique() returns trigger as $$
begin
  if new.produit_canonique_id is not null then
    if new.produit_canonique_id = new.id then
      raise exception 'Un produit ne peut pas être son propre canonique';
    end if;
    if exists (select 1 from produits where id = new.produit_canonique_id and produit_canonique_id is not null) then
      raise exception 'Le produit canonique référencé (%) est lui-même une variante — pas de chaînage', new.produit_canonique_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_verifier_produit_canonique
  before insert or update of produit_canonique_id on produits
  for each row execute function verifier_produit_canonique();
```

`produit_canonique_id` nullable, auto-référence. Aucune fusion, aucune suppression — l'EAN promotionnel garde sa ligne `produits` et ses liens `promo_produits` existants tels quels. `famille`/`segment` sont désormais stockés (pas reportés en Phase 2) : ils servent dès cette phase au regroupement d'affichage et à la comparabilité des magasins.

`produits_enseigne.typologie` (déjà `text`) stocke le vrai code d'enseigne (`T1`..`T6`, `H1`..`H4`, `MN`, `MD`, `Région`) pour Auchan/Carrefour/Carrefour Market, `null` pour Intermarché/Leclerc/U. Le type TypeScript `Typologie` passe de `'obligatoire' | 'picking'` à `string`.

## Import « Plan de vente LNUF »

Nouvelle action admin `importPlanDeVente`, même famille que `importVmh`/`importVmhEnseigne`. Lit les 6 onglets (un par enseigne) : `EAN PRODUIT`, `NOM DU PRODUIT`, `FAMILLE`, `SEGMENT`, `TYPOLOGIE` (optionnelle).

**Aperçu avant validation** — l'admin doit voir, par enseigne, avant tout écriture :
- références détectées, ajouts, mises à jour, changements de typologie, retraits, EAN inconnus, doublons, onglets manquants.

Exemple d'aperçu :
```
Leclerc — 156 références détectées
4 ajouts · 6 mises à jour · 3 retraits · 0 EAN inconnu
```

**Comportement d'écriture** (après confirmation de l'aperçu) :
- upsert `produits_enseigne` (produit_id, enseigne, typologie) pour chaque EAN listé, `famille`/`segment` mis à jour sur `produits`.
- toute ligne `produits_enseigne` de cette enseigne dont le produit n'apparaît pas dans l'import est **désactivée**, pas supprimée — ajout d'une colonne `produits_enseigne.actif boolean not null default true` ; les lectures d'assortiment filtrent `actif = true`. Permet un retour arrière sans ré-import.
- EAN du classeur introuvable dans `produits` → ligne listée dans l'aperçu comme "EAN inconnu", pas de création automatique, import du reste non bloqué.
- **Transactionnel** : toutes les écritures d'une exécution d'import (toutes enseignes du classeur) réussissent ensemble ou aucune n'est appliquée.
- **Historisé** : chaque exécution enregistre un résumé (date, admin, compteurs par enseigne) dans une table `imports_plan_de_vente` pour audit et pour permettre de comprendre un écart constaté plus tard.
- **Fichier incomplet refusé** : si un onglet attendu manque ou si une enseigne passe à 0 référence alors qu'elle en avait au moins une avant, l'import s'arrête avec une erreur explicite plutôt que de désactiver silencieusement tout l'assortiment de cette enseigne.

## Résolution à la lecture et à l'écriture

```
idEffectif(produitId) = produits[produitId].produit_canonique_id ?? produitId
```

**À la lecture**, résoudre systématiquement avant d'utiliser un `produit_id` issu de `promo_produits` pour : l'assortiment, la présence/absence/rupture, les Top 20/50/70, les VMH, la comparabilité entre magasins, les priorités de la semaine. Concrètement dans `lib/engine/promo-liens.ts` (regroupement des `PromoLien[]`) et dans le chargement de `statuts_produit_magasin` (`prioritesSemaine`, `fiche-magasin.ts`).

**À l'écriture**, la Server Action qui enregistre un signalement de statut (présent/manquant/rupture) résout `produit_id` vers son canonique avant l'upsert — impossible de créer `présent` sur l'EAN permanent et `manquant` sur son EAN promotionnel comme deux faits distincts pour le même produit réel. En pratique, une fois l'assortiment reconstruit (Phase 1, section précédente), l'écran de signalement ne propose de toute façon plus que des produits canoniques — la résolution à l'écriture est une garde défensive, pas le mécanisme principal.

**Distinction conservée** : le statut d'assortiment permanent est rattaché au canonique ; un futur constat d'exécution d'une opération promotionnelle spécifique (non construit en Phase 1 — aucune UI ne le permet aujourd'hui) resterait, lui, rattaché à l'EAN promotionnel réel s'il existait. Le signalement historique d'Auchan La Défense est récupéré par résolution à la lecture uniquement, sans réécriture de la ligne existante.

## Affichage des noms complets

Le nom affiché doit toujours inclure marque, gamme, parfum/recette, nombre d'unités et grammage/volume unitaire, et ne jamais être dédupliqué par un nom simplifié qui masquerait des références distinctes (`Siggi's Nature` x2 140g / x1 450g / x1 825g / x8 100g doivent rester visuellement distinctes partout).

`NOM DU PRODUIT` du plan de vente devient la source du nom d'affichage pour les références permanentes (normalisable pour la casse/ponctuation, jamais tronqué du format). Exemples :
- `Flanby Caramel & Vanille — x6 pots de 100 g`
- `I Love Kefir Nature — bouteille 500 g`
- `La Laitière Le Yaourt Vanille — x4 pots de 125 g`
- `La Laitière Feuilleté de Mousse Chocolat — 3 x 57 g + 1 offert` (promo)

L'EAN reste visible en information secondaire (sous le nom ou dans le détail), jamais comme seul identifiant visuel.

## Organisation de la liste d'assortiment

Dans la fiche magasin, regroupement dans cet ordre : **famille → segment → nom complet → format**. Chaque ligne = une seule référence permanente, avec nom complet, EAN en secondaire, typologie si connue, badge Top 20/50/70 le cas échéant, et les boutons Présent/Manquant/Rupture. Les variantes promotionnelles associées sont consultables dans le détail de la ligne, jamais comme ligne séparée dans la liste.

## Effet dans les priorités

Quand un EAN promotionnel est relié à un produit permanent, une seule priorité regroupée est produite (pas une priorité par EAN promotionnel pointant vers le même canonique). Elle combine : produit permanent manquant, conditionnement promotionnel concerné, dates de promotion, opération trade, Top 20/50/70, VMH, présence dans les magasins comparables, arguments de vente — dans une action principale avec, si besoin, plusieurs raisons/promotions associées plutôt que des priorités concurrentes.

Règle de fond conservée : **produit permanent absent + promotion à venir dans l'enseigne = priorité forte de la semaine.** Le Top 20/50/70 renforce le score mais ne crée pas seul une priorité hebdomadaire en l'absence de promotion ou d'un autre signal fort.

## Rapport de correspondances canoniques

**60 liens créés** (48 initiaux + 12 confirmés par l'utilisateur après vérification) :

| EAN variante | Nom variante | → EAN canonique | Nom canonique | Type |
|---|---|---|---|---|
| 3023290052150 | FDM vanille OD 4x57g | 3023290050286 | Feuilleté De Mousse Vanille x4 57g | conditionnement_promo |
| 3023290052068 | FDM chocolat noir OD 4x57g | 3023290029862 | Feuilleté De Mousse Chocolat Noir x4 57g | conditionnement_promo |
| 3023290079034 | FDM menthe OD 4x57g | 3023290079003 | Feuilleté De Mousse Menthe x4 57g | conditionnement_promo |
| 3023290052181 | FDM chocolat OD 4x57g | 3023290050255 | Feuilleté De Mousse Chocolat x4 57g | conditionnement_promo |
| 3023290097397 | FDM vanille 3x57g +1 offert | 3023290050286 | Feuilleté De Mousse Vanille x4 57g | conditionnement_promo |
| 3023290097335 | FDM chocolat noir 3x57g +1 offert | 3023290029862 | Feuilleté De Mousse Chocolat Noir x4 57g | conditionnement_promo |
| 3023290097427 | FDM menthe 3x57g +1 offert | 3023290079003 | Feuilleté De Mousse Menthe x4 57g | conditionnement_promo |
| 3023290097366 | FDM chocolat 3x57g +1 offert | 3023290050255 | Feuilleté De Mousse Chocolat x4 57g | conditionnement_promo |
| 3023290098578 | FDM pistache 3x57g +1 offert | 3023290097458 | Feuilleté De Mousse Pistache x4 57g | conditionnement_promo |
| 3023290170427 | RAL rhum raisin OD 4x115g | 3023290169940 | Riz Au Lait Rhum Raisin x4 115g | conditionnement_promo |
| 3023290230152 | RAL rhum raisin 4x115g +2 offerts | 3023290169940 | Riz Au Lait Rhum Raisin x4 115g | conditionnement_promo |
| 3023290170403 | RAL nature OD 4x115g | 3023290205068 | Riz Au Lait Nature x4 115g | conditionnement_promo |
| 3023290092101 | RAL chocolat OD 4x115g | 3023290092088 | Riz Au Lait Chocolat x4 115g | conditionnement_promo |
| 3023290092118 | RAL chocolat 4x115g +2 offerts | 3023290092088 | Riz Au Lait Chocolat x4 115g | conditionnement_promo |
| 3023290170434 | RAL vanille OD 4x115g | 3023290036686 | Riz Au Lait Vanille x4 115g | conditionnement_promo |
| 3023290170892 | RAL vanille 4x115g +2 offerts | 3023290036686 | Riz Au Lait Vanille x4 115g | conditionnement_promo |
| 3023290170441 | RAL vanille OD 8x115g | 3023290036716 | Riz Au Lait Vanille x8 115g | conditionnement_promo |
| 3023290092125 | SAL chocolat OD 4x115g | 3023290092095 | Semoule Au Lait Chocolat x4 115g | conditionnement_promo |
| 3023290092132 | SAL chocolat 4x115g +2 offerts | 3023290092095 | Semoule Au Lait Chocolat x4 115g | conditionnement_promo |
| 3023290068205 | SAL rhum raisin OD 4x115g | 3023290068175 | Semoule Au Lait Rhum Raisin x4 115g | conditionnement_promo |
| 3023290068236 | SAL rhum raisin 4x115g +2 offerts | 3023290068175 | Semoule Au Lait Rhum Raisin x4 115g | conditionnement_promo |
| 3023290170458 | SAL nature OD 4x115g | 3023290115176 | Semoule Au Lait Nature x4 115g | conditionnement_promo |
| 3023290170465 | SAL vanille OD 4x115g | 3023290036655 | Semoule Au Lait Vanille x4 115g | conditionnement_promo |
| 3023290170885 | SAL vanille 4x115g +2 offerts | 3023290036655 | Semoule Au Lait Vanille x4 115g | conditionnement_promo |
| 3023290170472 | SAL vanille OD 8x115g | 3023290634738 | Semoule Au Lait Vanille x8 115g | conditionnement_promo |
| 3023290165348 | PPC vanille OD 4x100g | 3023290035924 | Le Petit Pot De Crème Vanille x4 100g | conditionnement_promo |
| 3023290165393 | PPC chocolat OD 4x100g | 3023290035801 | Le Petit Pot De Crème Chocolat x4 100g | conditionnement_promo |
| 3023290165379 | PPC caramel OD 4x100g | 3023290035689 | Le Petit Pot De Crème Caramel x4 100g | conditionnement_promo |
| 3023290165362 | PPC café OD 4x100g | 3023290035627 | Le Petit Pot De Crème Café x4 100g | conditionnement_promo |
| 3023290165355 | PPC biscuit OD 4x100g | 3023290640265 | Le Petit Pot De Crème Biscuit x4 100g | conditionnement_promo |
| 3023290165386 | PPC chocolat noir OD 4x100g | 3023290623527 | Le Petit Pot De Crème Chocolat Noir x4 100g | conditionnement_promo |
| 3023290165409 | PPC pistache OD 4x100g | 3023290640586 | Le Petit Pot De Crème Pistache x4 100g | conditionnement_promo |
| 3023290093054 | Siggi's nature 1x825g dont 20% offert | 3023290091142 | Siggi's Nature x1 825g | conditionnement_promo |
| 3023290799482 | YPV fraise OD 4x125g | 3023290101957 | Le Yaourt Fraise x4 125g | conditionnement_promo |
| 3023290011546 | YPV vanille OD 8x125g | 3023290021286 | Le Yaourt Vanille x8 125g | conditionnement_promo |
| 3023290419700 | YPV vanille OD 4x125g | 3023290234853 | Le Yaourt Vanille x4 125g | conditionnement_promo |
| 3023290095454 | YPV citron OD 8x125g | 3023290095409 | Le Yaourt Citron x8 125g | conditionnement_promo |
| 3023290419694 | YPV citron OD 4x125g | 3023290101964 | Le Yaourt Citron x4 125g | conditionnement_promo |
| 3023290021507 | Viennois chocolat OD 4x100g | 3023290050378 | Nestle Le Viennois Chocolat x4 100g | conditionnement_promo |
| 3023290021712 | Viennois café OD 4x100g | 3023290050347 | Nestle Le Viennois Café x4 100g | conditionnement_promo |
| 3023290021590 | Viennois fraise OD 4x100g | 3023290418833 | Nestle Le Viennois Fraise x4 100g | conditionnement_promo |
| 3023290052310 | Viennois caramel OD 4x100g | 3023290013427 | Nestle Le Viennois Caramel x4 100g | conditionnement_promo |
| 3023290623572 | Yaos nature 4x150g +2 offerts | 3023291122005 | Nestle Yaos Nature x4 150g | conditionnement_promo |
| 3023290010532 | Yaos nature OD 4x150g | 3023291122005 | Nestle Yaos Nature x4 150g | conditionnement_promo |
| 3023290234686 | Yaos vanille 4x125g +2 offerts | 3023290115282 | Nestle Yaos Vanille x4 125g | conditionnement_promo |
| 3023290010570 | Yaos vanille OD 4x125g | 3023290115282 | Nestle Yaos Vanille x4 125g | conditionnement_promo |
| 3023290234709 | Yaos citron 4x125g +2 offerts | 3023290115251 | Nestle Yaos Citron x4 125g | conditionnement_promo |
| 3023290010464 | Yaos citron OD 4x125g | 3023290115251 | Nestle Yaos Citron x4 125g | conditionnement_promo |
| 3023290097113 | YPV vanille 6x125g +2 offerts | 3023290021286 | Le Yaourt Vanille x8 125g | conditionnement_promo |
| 3023290098417 | YPV citron 6x125g +2 offerts | 3023290095409 | Le Yaourt Citron x8 125g | conditionnement_promo |
| 3023290098530 | YPV coco OD 4x125g | 3023290095379 | Le Yaourt Noix De Coco x4 125g | conditionnement_promo |
| 3023290021651 | Viennois mousse chocolat OD 4x90g | 3023292259014 | Nestle Mousse De Viennois Chocolat x4 90g | conditionnement_promo |
| 3023290021569 | Viennois mousse café OD 4x90g | 3023292259144 | Nestle Mousse De Viennois Café x4 90g | conditionnement_promo |
| 3023290021620 | Viennois vanille caramel OD 4x100g | 3023290620144 | Nestle Le Viennois Caramel & Vanille x4 100g | conditionnement_promo |
| 3023290032732 | Yaos coco 4x125g +2 offerts | 3023290030776 | Nestle Yaos Noix De Coco x4 125g | conditionnement_promo |
| 3023290032763 | Yaos coco OD 4x125g | 3023290030776 | Nestle Yaos Noix De Coco x4 125g | conditionnement_promo |
| 3023290096505 | Yaos café 4x125g +2 offerts | 3023290096475 | Nestle Yaos Brasse Chaud Cafe x4 125g | conditionnement_promo |
| 3023290097519 | Yaos café OD 4x125g | 3023290096475 | Nestle Yaos Brasse Chaud Cafe x4 125g | conditionnement_promo |
| 3023290091937 | Yaos pistache 4x125g +2 offerts | 3023290091555 | Nestle Yaos Brasse Chaud Pistache x4 125g | conditionnement_promo |
| 3023290092057 | Yaos pistache OD 4x125g | 3023290091555 | Nestle Yaos Brasse Chaud Pistache x4 125g | conditionnement_promo |

**16 laissés `a_qualifier`** — pas de correspondance fiable, aucun lien créé :

| EAN | Nom | Raison |
|---|---|---|
| 3023290069226 | Lindahls Pro + Stracciatella x1 330g | Nom identique à un produit du plan de vente (x2 160g) mais aucun marqueur promo (`OD`/`+offert`) — vraisemblablement un format permanent distinct, pas une variante |
| 3023290093641 | La Laitiere Le Petit Pot De Creme Chocolat & Noisette | Aucune correspondance de nom |
| 3023290069608 | La Laitiere Fraise (seule) | Aucune correspondance de nom |
| 3023290069646 | La Laitiere Peche (seule) | Aucune correspondance de nom |
| 3023290095942 | Lindahls Protein Crunchy Chocolat | Aucune correspondance de nom |
| 3023290095966 | Lindahls Protein Crunchy Fraise | Aucune correspondance de nom |
| 3023290097571 | I Love Kefir & Granola Nature | Aucune correspondance de nom |
| 3023290096178 | La Laitière VDC vanille 4x85g | Aucune correspondance de nom |
| 3023290210086 | Flanby vanille 12x100g +4 offerts | Variante promo confirmée mais format cible (x6 ou x12) incertain |
| 3023290003046 | RAL nature sur lit de caramel OD 4x115g | Recette potentiellement différente de "Nature Caramel Beurre Salé" — nécessite confirmation visuelle |
| 3023290003060 | RAL nature sur lit de caramel 4x115g +2 offerts | Idem |
| 3023290097069 | YPV panaché 6x125g +2 offerts | Composition du panaché à confirmer visuellement |
| 3023290098462 | YPV nouveau panaché 6x125g +2 offerts | "Nouveau" panaché possiblement différent des autres panachés |
| 3023290103494 | YPV panaché OD 8x125g | Composition à confirmer |
| 3023290097489 | YPV nouveau panaché OD 8x125g | Idem "nouveau" |
| 3023290620182 | YAF PAT panaché 12x125g +4 offerts | Composition à confirmer |

## Tests

- `lib/import/mappers.test.ts` : mapper plan de vente (EAN/nom/famille/segment/typologie), ligne sans typologie.
- `importPlanDeVente` : vérifié en direct contre la vraie base via script (comme les imports précédents) — couvrant idempotence (ré-import identique = 0 changement), doublon d'EAN dans le classeur, EAN inconnu, onglet manquant, fichier avec une enseigne à 0 référence (refusé).
- Trigger `verifier_produit_canonique` : auto-référence rejetée, chaînage à 2 niveaux rejeté.
- `lib/engine/priorites.test.ts` / `produit-a-travailler.test.ts` / `fiche-magasin.test.ts` : résolution canonique à la lecture (statut/promo du variant compte pour le canonique), regroupement d'une seule priorité pour plusieurs variantes promo du même canonique.
- Écriture d'un statut : résolution à l'écriture (signaler sur un variant enregistre sur le canonique).
- Retrait des tests couvrant l'ancien flag "obligatoire" binaire.

## Critères d'acceptation

1. La feuille Leclerc donne exactement 156 références d'assortiment (idem pour les 5 autres enseignes, valeurs ci-dessus).
2. Les variantes OD et « + offerts » ne figurent plus comme lignes permanentes d'assortiment.
3. Flanby x6 et Flanby x12 ont des noms complets distincts, jamais dédupliqués.
4. Toutes les références homonymes sont distinguables par leur format dans tous les écrans.
5. Les EAN sont affichables en information secondaire.
6. Auchan, Carrefour et Carrefour Market affichent leur typologie ; les 3 autres n'affichent pas de typologie artificielle.
7. Un manquant permanent lié à une promotion à venir déclenche une priorité forte, montrant le permanent et le pack promotionnel.
8. Aucun produit réellement différent n'est fusionné.
9. Les Top 20/50/70 continuent de fonctionner avec le produit canonique.
10. Les statuts Présent/Manquant/Rupture ne sont pas dupliqués entre EAN permanent et EAN promotionnel.
11. L'import est prévisualisable et restaurable (désactivation, pas suppression).
12. Les tests couvrent idempotence, doublons, EAN inconnus, fichiers incomplets, résolution canonique.

## Hors scope (Phase 2)

Déclaration de typologie par magasin (par famille/segment), modules MN/MD activables par magasin, recalcul obligatoire/picking par comparaison.
