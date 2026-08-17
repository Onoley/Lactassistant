# Fiche magasin enrichie — argumentaire, questions de découverte, VMH nationale

Date : 2026-08-17
Statut : validé par l'utilisateur en chat au fil du brainstorming, spec rédigée pour revue finale avant plan d'implémentation.
Sous-projet 2 sur 5 de la refonte de la logique métier centrale de Lactassistant (voir §7 du spec du sous-projet 1 pour la décomposition d'ensemble).

## 1. Contexte

Le sous-projet 1 a livré `prioritesSemaine` (priorité hebdomadaire, dated/urgent uniquement) et `importanceProduitFiche` (importance produit sur une fiche magasin, rang + comparables + promo), avec un verrou dur `actionRecommandee` empêchant toute recommandation de commande sur un produit non commandable. Constat de la revue finale du sous-projet 1 : `actionRecommandee` est calculé mais n'est affiché nulle part — la garantie existe dans le moteur mais n'est pas encore visible pour un utilisateur. Ce sous-projet la rend visible, et enrichit la fiche magasin avec l'argumentaire complet demandé depuis le départ par l'utilisateur : *"il doit y avoir les prio de la semaine et également ... une synthèse et des argumentaire et des priorité / magasin dans la fiche magasin"*.

## 2. Objectif

Restructurer la fiche magasin (`app/magasins/[id]/page.tsx`) en trois zones :
1. Les priorités hebdomadaires de ce magasin (issues de `prioritesSemaine`), en haut, compactes.
2. Une section "produits manquants à travailler", classée par la hiérarchie de signaux existante, avec pour chaque produit : rang, raisons, comparables, promo, raison d'absence, argumentaire prêt, questions de découverte, action recommandée, pastille de momentum.
3. L'assortiment complet en dessous, pour le changement de statut rapide (comme aujourd'hui).

Et enrichir le signal disponible avec deux nouvelles données :
- Une raison d'absence, saisie par le commercial.
- Un repère VMH national (ventes hebdomadaires moyennes + taux de distribution), importé depuis un export panel fourni par l'utilisateur.

## 3. Modèle de données

### 3.1 Raison d'absence

```sql
alter table statuts_produit_magasin
  add column raison_absence text
  check (raison_absence in ('pas_de_place_rayon', 'frein_prix', 'jamais_reference', 'concurrence_privilegiee', 'autre'));
```

Nullable, éditable uniquement quand `statut ∈ {'manquant', 'rupture'}` (pas de contrainte DB sur ce point — même convention que `statut_disponibilite`, qui n'est pas non plus contraint par le statut du produit magasin). Édition : nouveau contrôle sur la fiche magasin, à côté du `StatutSelect` existant, visible seulement quand le statut est manquant/rupture. Nouvelle server action `definirRaisonAbsence(magasinId, produitId, raison)`.

### 3.2 VMH national

Source unique : l'onglet "Vision CAT" du fichier fourni (`vmh et produit 2.xlsx`) — une ligne par EAN, toute la catégorie (pas seulement LNUF), colonnes propres et fiables à 100 % (contrairement aux onglets par enseigne, où le détail VMH est absent chez Leclerc et Intermarché dans cet export — 0 % de lignes renseignées contre 100 % chez Carrefour et Système U — donc non exploitable enseigne par enseigne pour l'instant). Rapprochement par EAN (`Desc EAN`, colonne 11 de l'onglet, 1-indexée) avec `produits.code` — vérifié, 1524 EAN distincts dans le fichier, correspondance confirmée sur échantillon.

```sql
create table vmh_national (
  produit_id uuid primary key references produits(id) on delete cascade,
  vmh_hyper numeric,
  vmh_super numeric,
  dv_hmsm numeric,
  dv_hyper numeric,
  dv_super numeric,
  prix_moyen numeric,
  periode_reference text,
  updated_at timestamptz not null default now()
);

alter table vmh_national enable row level security;
create policy "vmh_national_select_all" on vmh_national for select using (auth.role() = 'authenticated');
create policy "vmh_national_admin_write" on vmh_national for all
  using ((select role from current_profile()) = 'admin');
```

Colonnes source → destination (onglet "Vision CAT", index 0-based dans la ligne, "Cumul 3 Dernières Périodes" préféré à "Dernière Période" seule pour la stabilité, sauf le prix où la période la plus récente est plus pertinente) :

| Colonne destination | Colonne source (index) | Libellé source |
|---|---|---|
| `vmh_hyper` | 18 | VMH Unité Ajustées HM, Cumul 3 Dernières Périodes |
| `vmh_super` | 20 | VMH Unité Ajustées SM, Cumul 3 Dernières Périodes |
| `dv_hmsm` | 15 | DV HMSM, Dernière Période |
| `dv_hyper` | 16 | DV HM, Dernière Période |
| `dv_super` | 17 | DV SM, Dernière Période |
| `prix_moyen` | 11 | Prix Moyen Unité, Dernière Période |
| `periode_reference` | — | libellé texte de la période "Cumul 3 Dernières Périodes" lu en ligne 5 (repère de fraîcheur affiché à l'admin) |

Import : nouvel onglet sur la page `/admin/import` existante, réutilisant le pipeline `lib/import/parser.ts` + un nouveau mapper dédié (le fichier a une structure différente des imports existants : ligne d'en-tête à la ligne 4, pas de ligne 1). Lignes sans EAN ou dont l'EAN ne correspond à aucun `produits.code` sont ignorées silencieusement (comportement upsert par EAN, comme les imports existants).

### 3.3 PDL magasin (part de linéaire)

Nouvelle table, un enregistrement par magasin, saisi et mis à jour librement par le commercial depuis la fiche magasin — tous les champs sont optionnels, aucun ne bloque l'enregistrement des autres :

```sql
create table pdl_magasin (
  magasin_id uuid primary key references magasins(id) on delete cascade,
  pdl_generale numeric,   -- PDL globale LNUF dans le magasin
  pdl_yaos numeric,
  pdl_siggis numeric,
  pdl_dessert numeric,    -- segment Dessert : Viennois + La Laitière combinés
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table pdl_magasin enable row level security;
create policy "pdl_magasin_select_visible" on pdl_magasin for select
  using (magasin_id in (select id from magasins where secteur_id in (select visible_secteurs())));
create policy "pdl_magasin_write_visible" on pdl_magasin for all
  using (magasin_id in (select id from magasins where secteur_id in (select visible_secteurs())));
```

Valeurs en pourcentage (0-100), saisie libre (pas de contrainte de plage en base — un commercial peut vouloir noter une estimation approximative). Nouvelle server action `definirPdl(magasinId, champ, valeur)`. Affiché et éditable dans la fiche magasin, pas dans le calcul du moteur pour ce sous-projet (donnée de suivi/comparaison manuelle, pas encore un signal automatisé — cohérent avec la demande : *"c'est toujours des données en plus à pouvoir comparer"*, pas une exigence de calcul immédiat).

### 3.4 Typologie obligatoire / picking

Réutilise la colonne `produits_enseigne.typologie` (existante depuis la migration `0002`, jamais encore exploitée). Convention de valeur figée pour ce sous-projet :

```
typologie ∈ { 'obligatoire', 'picking' } | null
```

- `'obligatoire'` : l'enseigne impose ce produit dans tous ses magasins (référencement national/central) — un magasin qui ne l'a pas est en écart de conformité, pas un simple choix.
- `'picking'` : l'enseigne laisse le magasin choisir librement dans la gamme — un magasin qui ne l'a pas n'est pas en tort.
- `null` (valeur par défaut actuelle, inchangée) : distinction non renseignée pour cette enseigne — traité comme `'picking'` par le moteur (comportement actuel préservé, aucune régression sur les enseignes où l'admin n'aura pas encore renseigné cette donnée).

Édition : sélecteur ajouté sur `/admin/produits`, dans la même cellule que la case à cocher d'assortiment et le sélecteur `statut_disponibilite` du sous-projet 1 (visible seulement quand l'enseigne est cochée).

## 4. Découpage du moteur

### 4.1 `produitATravailler` — nouvelle fonction de composition

Nouveau fichier `lib/engine/produit-a-travailler.ts`. Ne rouvre pas `importanceProduitFiche` (déjà livré et testé au sous-projet 1) — compose ses résultats avec les nouvelles données.

```ts
export interface ProduitATravailler {
  produit: Produit
  rang: 20 | 50 | 70 | null
  typologie: 'obligatoire' | 'picking' | null
  raisons: string[]              // reprend ImportanceProduit.raisons
  presentsChezComparables: { total: number; presents: number }
  vmhNational: { vmh: number | null; dv: number | null } | null  // null si aucune ligne vmh_national pour ce produit
  raisonAbsence: string | null
  argumentaire: string            // phrase factuelle, croise comparables + promo + VMH (si dispo) + raison d'absence + typologie
  questionsDecouverte: string[]   // 2-4 questions, selon raisonAbsence, génériques si raisonAbsence est null
  actionRecommandee: ActionRecommandee
  momentum: 'urgent' | 'cette_semaine' | 'a_anticiper' | null  // niveau si ce produit est aussi dans prioritesSemaine pour ce magasin, sinon null
}

export function produitATravailler(
  magasin: Magasin,
  produit: Produit,
  rang: Rang | null,
  typologie: 'obligatoire' | 'picking' | null,
  statutProduitMagasin: StatutProduit,
  raisonAbsence: string | null,
  statutDisponibilite: StatutDisponibilite,
  magasinsComparables: Magasin[],
  statutsComparables: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  vmhNational: { vmh_hyper: number | null; vmh_super: number | null; dv_hmsm: number | null; dv_hyper: number | null; dv_super: number | null } | null,
  critere: CritereSimilarite,
  niveauHebdo: NiveauPriorite | null,   // le niveau de ce (magasin, produit) dans prioritesSemaine, si présent
  aujourdHui?: Date
): ProduitATravailler
```

Note : `rang` peut être `null` (un produit manquant sans priorité Top20/50/70 assignée existe déjà dans le moteur actuel — `chargerArgumentsFicheMagasin` retourne une ligne à score 0 dans ce cas). Quand `rang` est `null`, `importanceProduitFiche` n'est pas appelable (elle exige un `Rang`) — dans ce cas, `raisons`/`presentsChezComparables` restent vides/nulles et l'argumentaire se limite aux signaux disponibles (promo, VMH, raison d'absence, typologie).

### 4.2 Sélection du VMH par format

```ts
function vmhPertinent(magasin: Magasin, vmhNational: {...} | null): { vmh: number | null; dv: number | null } | null {
  if (!vmhNational) return null
  if (magasin.taille === 'hyper') return { vmh: vmhNational.vmh_hyper, dv: vmhNational.dv_hyper }
  if (magasin.taille === 'super') return { vmh: vmhNational.vmh_super, dv: vmhNational.dv_super }
  return { vmh: null, dv: vmhNational.dv_hmsm }  // proxi/drive : pas de ventilation par format dans le panel
}
```

### 4.3 Générateur d'argumentaire

Phrase factuelle unique, construite en enchaînant les signaux disponibles (jamais de garantie de performance — toujours "justifie de tester/proposer", jamais "va bien se vendre") :

- Si `typologie === 'obligatoire'` : ouverture systématique par le rappel de conformité, avant tout autre signal — *"Référencement obligatoire chez [enseigne] — son absence est un écart à signaler en priorité."* (ton différent du reste : ce n'est pas une proposition, c'est un manquement à corriger).
- Base comparables (reprend `raisons` d'`importanceProduitFiche` si non vide) : *"Présent chez X/Y magasins comparables du secteur"*.
- + VMH national si disponible : *"— au national, ce produit tourne à Z unités/semaine en moyenne dans les [hypers|supers] et est référencé par W % d'entre eux"*.
- + Promo si présente : reprend le format déjà utilisé par `prioritesSemaine`/`importanceProduitFiche` (mécanique, enseigne, échéance).
- + Raison d'absence si connue : *"Frein identifié : [libellé lisible de la raison]."*
- Conclusion toujours actionnable et datée quand une action recommandée existe : *"→ [libellé de l'action recommandée], à valider au prochain passage."*

Si `actionRecommandee === 'aucune_action_commande'` (verrou non commandable), l'argumentaire ne propose jamais de commande — il explique pourquoi : *"Produit non commandable actuellement ([arrêt industriel|déréférencé]) — aucune action de commande possible."* (prioritaire sur la phrase d'ouverture "obligatoire" : un produit non commandable ne peut de toute façon pas être corrigé par une commande, même s'il est censé être obligatoire).

### 4.4 Générateur de questions de découverte

Liste fermée de 2-4 questions par `raisonAbsence`, plus un jeu générique quand `raisonAbsence` est `null` :

```ts
const QUESTIONS_PAR_RAISON: Record<string, string[]> = {
  pas_de_place_rayon: [
    "Quel produit fait le moins de rotation dans ce rayon actuellement ?",
    "Y a-t-il un rayon secondaire ou une tête de gondole disponible ?",
  ],
  frein_prix: [
    "Quel est le prix psychologique attendu par le client sur ce segment ?",
    "Une opération prix ponctuelle serait-elle envisageable ?",
  ],
  jamais_reference: [
    "Qu'est-ce qui bloque le référencement initial : espace, centrale, autre ?",
    "Le rayon actuel couvre-t-il déjà ce segment via un concurrent ?",
  ],
  concurrence_privilegiee: [
    "Qu'est-ce qui différencie l'offre concurrente actuellement en rayon ?",
    "Un test comparatif sur linéaire serait-il possible ?",
  ],
  autre: [
    "Quel est le principal frein perçu par le magasin sur ce produit ?",
  ],
}
const QUESTIONS_GENERIQUES = [
  "Ce produit a-t-il déjà été référencé dans ce magasin par le passé ?",
  "Quel est le principal frein perçu par le magasin sur ce produit ?",
]
```

## 5. Fiche magasin — nouvelle structure (`app/magasins/[id]/page.tsx`)

0. **PDL du magasin** — un petit bloc avec les 4 champs de §3.3 (générale, YAOS, SIGGI'S, Dessert), éditables en place (input numérique, enregistrement à la perte de focus), affichés même sans valeur (placeholder "-"). Emplacement : sous l'en-tête du magasin, avant les priorités.
1. **"Priorités de ce magasin"** — `prioritesSemaine(...)` filtré sur `p.magasin.id === magasin.id`. Chaque entrée : pastille de niveau colorée (réutilise `COULEUR_NIVEAU`/`LIBELLE_NIVEAU` de `components/priorites-liste.tsx` — ces deux constantes ne sont actuellement pas exportées de ce fichier, il faut ajouter `export` devant les deux, changement mineur inclus dans ce sous-projet), magasin/produit, et un bouton "Voir les raisons" qui déplie la raison complète (état local, replié par défaut — reste compact).
2. **"Produits manquants à travailler"** — une carte par produit avec `statut ∈ {manquant, rupture}`, triée en deux temps : d'abord les `typologie === 'obligatoire'` (écarts de conformité, toujours en tête), puis le reste par le score déjà calculé par `importanceProduitFiche` (inchangé) — affichant : nom/EAN, rang (si connu), typologie (badge "Obligatoire" si applicable), raisons, comparables (X/Y), promo (si présente), raison d'absence (avec le contrôle d'édition), argumentaire, questions de découverte, action recommandée (libellé simple, jamais le mot "score"), pastille de momentum (= couleur du niveau hebdomadaire si ce produit est aussi dans `prioritesSemaine` pour ce magasin, gris neutre sinon).
3. **L'assortiment complet**, comme aujourd'hui (tableau de tous les produits avec `StatutSelect`) — les raisons ne s'affichent plus inline ici, elles sont montées dans la section 2 — avec un champ de recherche par nom ou EAN au-dessus du tableau (même pattern que la recherche déjà en place sur `/admin/produits` : état local, filtre côté client, pas de nouvel appel serveur).

Aucune valeur brute de score n'est affichée nulle part — toujours du texte en langage clair (contrainte déjà en vigueur depuis le sous-projet 1, réaffirmée ici pour la nouvelle UI).

## 6. Hors périmètre (sous-projets suivants)

3. Page de synthèse dédiée au clic sur une visite planifiée (la section "priorités de ce magasin" de ce sous-projet couvre une partie du besoin depuis la fiche magasin elle-même, mais pas depuis le calendrier "Ma semaine").
4. Magasins comparables enrichis (champ `surface`, zone de chalandise, typologie plus fine que enseigne+taille).
5. Détail VMH par enseigne (actuellement non exploitable pour Leclerc/Intermarché dans l'export fourni) — seul l'agrégat national est utilisé ici.

## 7. Tests requis

- `produitATravailler` : cas avec/sans VMH disponible, avec/sans raison d'absence, avec/sans rang, avec `actionRecommandee === 'aucune_action_commande'` (l'argumentaire ne doit jamais proposer de commande dans ce cas — même exigence de non-régression que le sous-projet 1), avec `typologie === 'obligatoire'` (l'argumentaire ouvre par le rappel de conformité) et le cas conflictuel `typologie === 'obligatoire'` **et** `actionRecommandee === 'aucune_action_commande'` (le verrou non commandable l'emporte sur le ton "obligatoire").
- `vmhPertinent` : les 4 valeurs de `taille` (hyper/super/proxi/drive), y compris le repli HMSM.
- Générateur de questions de découverte : couverture des 5 valeurs de `raisonAbsence` + le cas générique (null).
- Mapper d'import VMH : lignes sans EAN ignorées, EAN ne correspondant à aucun produit ignoré, valeurs numériques correctement extraites (test contre un extrait réel du fichier, comme les mappers magasins/produits/promos existants).
- Tri à deux niveaux de la section "produits manquants à travailler" : un produit `picking` mieux classé par `importanceProduitFiche` reste quand même après un produit `obligatoire` moins bien classé.
