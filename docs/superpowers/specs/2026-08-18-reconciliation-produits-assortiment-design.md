# Réconciliation produits / assortiment / typologie — Design

## Contexte

Les promos référencent parfois un EAN de conditionnement promotionnel (ex. `La Laitière FDM chocolat 3x57g +1 offert`) distinct de l'EAN vendable normal (`La Laitiere Feuillete De Mousse Chocolat x4 57g`) pour le même produit réel. Aujourd'hui l'app traite ces deux lignes `produits` comme deux produits indépendants : le rep ne peut signaler une absence que contre l'EAN vendable, donc une promo qui référence l'EAN promotionnel ne déclenche jamais correctement, et l'assortiment (`produits_enseigne`) est incomplet/incohérent (45% des produits référencés dans des promos n'avaient aucune ligne d'assortiment).

L'utilisateur a fourni deux fichiers Excel construits à la main à partir des vrais plans de vente LNUF par enseigne (Auchan, Carrefour, Carrefour Market, Intermarché, Leclerc, Système U) : liste exhaustive des EAN vendables par enseigne, avec famille/segment, et pour 3 enseignes (Auchan, Carrefour, Carrefour Market) une colonne typologie (T1-T6, H1-H4, MN, MD, Région — le système de tiering réel de chaque enseigne, jusqu'ici mal compris comme "donnée legacy").

## Ce qui est confirmé (vérifié contre les données réelles)

- **159 EAN listés dans les plans de vente existent déjà tous dans `produits`** — aucune création de produit nécessaire.
- **76 produits du catalogue n'apparaissent sur aucun plan de vente.** 49 se rattachent avec confiance à un produit canonique par correspondance de nom (abréviations connues : FDM=Feuilleté De Mousse, RAL=Riz Au Lait, SAL=Semoule Au Lait, PPC=Le Petit Pot De Crème, YPV=Le Yaourt, suffixes `OD`/`+N offert(s)` stripés) + format de conditionnement pour lever les ambiguïtés. 27 restent sans correspondance fiable — liste en annexe, à trancher avec l'utilisateur avant d'exécuter le lien.
- **La typologie T1-T4/H1-H4/MN/MD/Région est réelle**, propre à chaque enseigne. MN = "module nature", MD = "module dessert" : des modules que le magasin active ou non (pas un niveau de priorité). T1/T2.../H1/H2... : le magasin se déclare lui-même à un niveau par famille/segment (donnée non encore collectée dans l'app — cf. Phase 2), et tout produit à ce niveau ou en-dessous est attendu ("obligatoire"), le reste est du picking.
- **1 signalement réel** (`statuts_produit_magasin`) existe contre un EAN promotionnel (`La Laitière RAL nature sur lit de caramel 4x115g +2 offerts`, magasin Auchan La Défense, manquant, signalé aujourd'hui) — cas réel à traiter par la résolution canonique, pas par une migration de données.
- **0 lignes `priorites_produits`** référencent un EAN promotionnel.

## Portée : Phase 1 (cette spec) vs Phase 2 (plus tard)

**Phase 1** (ce document) : corriger l'identité produit et l'assortiment — lien canonique, reconstruction de `produits_enseigne` depuis les plans de vente, stockage de la vraie typologie produit, résolution dans le moteur.

**Phase 2** (hors scope, sous-projet séparé) : collecte de la typologie déclarée par magasin (par famille/segment, saisie commercial), gestion des modules MN/MD par magasin, recalcul du flag obligatoire/picking par comparaison magasin↔produit. Sans cette pièce, le flag "obligatoire" ne peut pas être recalculé correctement — voir "Argumentaire" ci-dessous.

## Modèle de données

```sql
alter table produits add column produit_canonique_id uuid references produits(id);
```

Nullable, auto-référence. Quand renseigné, ce produit est une variante d'emballage promotionnelle ; le produit canonique est celui qui compte pour l'assortiment, le stock et les priorités. Pas de fusion, pas de suppression — l'EAN promotionnel garde sa ligne `produits` et ses liens `promo_produits` existants tels quels.

`produits_enseigne.typologie` (déjà `text`, pas de migration de type nécessaire) stocke désormais le vrai code d'enseigne (`T1`..`T6`, `H1`..`H4`, `MN`, `MD`, `Région`) pour Auchan/Carrefour/Carrefour Market, `null` pour Intermarché/Leclerc/U (pas de donnée). Le type TypeScript `Typologie` (`lib/types.ts`) passe de `'obligatoire' | 'picking'` à `string`, puisque l'enum binaire ne correspond plus à ce qui est réellement stocké.

## Import "Plan de vente LNUF"

Nouvelle action admin `importPlanDeVente(formData)`, même famille que `importVmh`/`importVmhEnseigne` (`lib/import/actions.ts`). Lit les 6 onglets (un par enseigne) du classeur fourni par l'utilisateur : `EAN PRODUIT`, `NOM DU PRODUIT`, `FAMILLE`, `SEGMENT`, `TYPOLOGIE` (colonne optionnelle — absente ou vide pour Intermarché/Leclerc/U).

Pour chaque enseigne présente dans le classeur :
- upsert `produits_enseigne` (produit_id, enseigne, typologie) pour chaque EAN listé — les colonnes `famille`/`segment` sont lues mais pas encore stockées (rien dans le schéma actuel ne les exploite ; ajoutées si besoin en Phase 2).
- supprime toute ligne `produits_enseigne` de cette enseigne dont le `produit_id` n'apparaît pas dans l'import — l'assortiment doit refléter exactement le plan de vente, pas un sur-ensemble hérité d'imports précédents.
- EAN du classeur introuvable dans `produits` → erreur d'import explicite (comme `importPromos`/`importVmh`), pas de création automatique.

Ce mécanisme remplace la CRUD manuelle comme source de vérité pour l'existence + la typologie ; la page admin assortiment reste disponible pour des ajustements ponctuels entre deux mises à jour du plan de vente.

## Résolution dans le moteur

Partout où `promo_produits.produit_id` ou `statuts_produit_magasin.produit_id` sert à regarder l'assortiment/statut/priorité d'un produit, résoudre d'abord via `produit_canonique_id` :

```
idEffectif(produitId) = produits[produitId].produit_canonique_id ?? produitId
```

Concrètement :
- `lib/engine/promo-liens.ts` (ou le point où les `PromoLien[]` sont regroupés en `Map<string, Promo[]>` dans `app/semaine/page.tsx`, `app/equipe/page.tsx`, `lib/engine/fiche-magasin.ts`) : regrouper par `idEffectif(lien.produit_id)`, pas par `lien.produit_id` brut.
- Chargement de `statuts_produit_magasin` (`prioritesSemaine`, `fiche-magasin.ts`) : même résolution, pour que le signalement "manquant" contre l'EAN promotionnel compte pour le produit canonique.

Nécessite de charger la table `produits` (déjà fait partout où c'est utilisé) avec `produit_canonique_id` inclus dans le select.

## Argumentaire — retrait temporaire du flag "obligatoire"

`construireArgumentaire` (`lib/engine/produit-a-travailler.ts`) vérifie aujourd'hui `typologie === 'obligatoire'` pour la phrase "Référencement obligatoire chez {enseigne}". Cette valeur littérale n'existera plus jamais dans les données réelles (remplacée par T1-T6/H1-H4/MN/MD/Région) — la condition ne se déclencherait donc plus jamais silencieusement. Je retire cette phrase et le sélecteur admin obligatoire/picking (`produit-row.tsx`) en Phase 1, remplacé par un simple champ texte libre pour ajustement manuel ponctuel de la typologie. Le rappel "obligatoire" reviendra en Phase 2, correctement calculé par comparaison avec la typologie déclarée du magasin.

## Cas nécessitant ton arbitrage (27)

**2 ambiguïtés de format** (aucun conditionnement exact ne correspond) :
- `La Laitière YPV vanille 6x125g +2 offerts` (3023290097113) — candidats : Le Yaourt Vanille x4 125g ou x8 125g
- `La Laitière YPV citron 6x125g +2 offerts` (3023290098417) — candidats : Le Yaourt Citron x4 125g ou x8 125g

**25 sans correspondance de nom** — soit un vocabulaire différent du mien (ex. "sur lit de caramel" vs "Caramel Beurre Sale" : peut-être la même recette, peut-être pas), soit une référence réellement absente de l'assortiment actuel :
`La Laitiere Le Petit Pot De Creme Chocolat & Noisette`, `La Laitiere Fraise` (seule), `La Laitiere Peche` (seule), `Lindahls Protein Crunchy Chocolat/Fraise`, `I Love Kefir & Granola Nature`, `La Laitière RAL nature sur lit de caramel` (OD + variante offerte), `La Laitière YPV panaché` / `nouveau panaché` (OD + variantes offertes), `La Laitière VDC vanille 4x85g`, `La Laitière YAF PAT panaché 12x125g +4 offerts`, `Viennois mousse chocolat/café OD`, `Viennois vanille caramel OD`, `Yaos coco/café/pistache` (OD + variantes offertes), `Flanby vanille 12x100g +4 offerts` (confirmé variante promo de Flanby Caramel & Vanille — format exact 6x100g ou 12x100g à confirmer).

## Tests

- `lib/import/mappers.test.ts` : mapper pour les lignes du plan de vente (EAN/nom/famille/segment/typologie), y compris ligne sans typologie.
- `importPlanDeVente` : aucun fichier `actions.ts` n'a de test unitaire dans ce projet (appellent Supabase directement) — vérifié en direct contre la vraie base via script, comme tous les imports précédents (VMH, promos, magasins).
- `lib/engine/priorites.test.ts` / `produit-a-travailler.test.ts` / `fiche-magasin.test.ts` : cas où un produit_id résolu diffère du produit_id brut (variante promo → canonique), vérifier que le statut/promo du variant compte pour le canonique.
- Retrait des tests couvrant l'ancien flag "obligatoire" binaire ; pas de nouveau test pour un comportement qui revient en Phase 2.

## Hors scope (Phase 2)

Déclaration de typologie par magasin (par famille/segment), modules MN/MD activables par magasin, recalcul obligatoire/picking par comparaison, stockage famille/segment si besoin futur.
