# Moteur de priorités commerciales — fondations : opportunités et pipeline de génération

Date : 2026-08-19
Statut : validé par l'utilisateur à l'issue d'un brainstorming en plusieurs passes, prêt pour la revue finale avant passage au plan d'implémentation.
Sous-projet 1 (nouvelle initiative) de la refonte du moteur de priorités commerciales — fait suite aux deux roadmaps déjà livrées : « Fondations du moteur — priorité hebdomadaire vs importance produit » (2026-08-17, 5 sous-projets, tous livrés) et « Réconciliation produits / assortiment / typologie » (2026-08-18, Phase 1 livrée).

## 1. Contexte

Lactassistant calcule aujourd'hui un score par produit et l'affiche en liste triée (`prioritesSemaine`, `chargerProduitsATravailler`). C'est fonctionnel mais ce n'est pas encore un assistant commercial : pas de notion de mission avec un objectif explicite, pas de persistance d'une opportunité dans le temps (tout est recalculé à chaque chargement à partir de l'état courant), pas de suivi d'un accord jusqu'à son résultat, pas de distinction entre « ce qu'il faut faire maintenant » et « ce qui serait intéressant ».

L'utilisateur a fourni une spécification fonctionnelle détaillée en 23 sections décrivant le moteur cible (missions typées, classification P1/P2/P3, score borné par niveau, regroupement, argumentaire structuré, persistance du cycle de vie, écrans Semaine/Aujourd'hui/Visite, configuration admin). Vu l'ampleur, ce travail a été découpé en sous-projets livrables indépendamment (voir §9). Ce document couvre uniquement le premier : **le modèle de données des opportunités et le pipeline qui les détecte, les classe et les met à jour.** Aucun écran n'est livré ici — c'est un choix délibéré validé en amont : construire la fondation avant l'affichage, pour ne pas avoir à reprendre le modèle une fois les écrans posés dessus.

## 2. Ce qui est réutilisé (audit du moteur existant)

Le pipeline ne part pas de zéro. Sont conservés et étendus, jamais dupliqués :

- `lib/engine/stade-promo.ts` (`stadePromo`) — couvre déjà les fenêtres promo (anticiper/revendre/contrôler/constater).
- `lib/engine/scoring.ts` — porte déjà les poids (`SCORE_PAR_RANG`, `SCORE_OP_TRADE`, `scoreMagasinsSimilaires`) ; la grille de score de ce sous-projet (§6) l'étend, ne le remplace pas.
- `lib/engine/priorites.ts` (`candidatsPourProduit`/`meilleurCandidat`, `resoudreCanonique`) — le squelette exact du classement par niveau à généraliser en classification P1/P2/P3 (§5).
- `lib/engine/similarity.ts` (`magasinsSimilaires`) — inchangé, réutilisé tel quel comme source de signal.
- `lib/engine/action-recommandee.ts` — modèle direct pour la logique d'exclusion par type de mission (§4).
- Résolution canonique (`produit_canonique_id`) et assortiment actif (`produits_enseigne.actif`) — livrés Phase 1, réutilisés partout où ce document parle de « produit ».
- `visites` (table existante, planifié/réalisé) — sert de point d'ancrage pour l'idempotence par visite (§7) et pour lier un événement d'opportunité à la visite où il s'est produit.

Rien de ceci n'est recréé en parallèle.

## 3. Modèle de données

### 3.1 Opportunités — état courant

```sql
create table opportunites (
  id uuid primary key default gen_random_uuid(),
  magasin_id uuid not null references magasins(id),
  produit_canonique_id uuid not null references produits(id),
  type_mission text not null check (type_mission in (
    'anticiper_promo','revendre_promo','constater_promo',
    'referencer_produit','corriger_rupture','securiser_commande',
    'suivre_engagement','optimiser_implantation','proposer_test_ht','verifier_information'
  )),
  promo_id uuid references promos(id),

  -- promo_id obligatoire pour les 3 types promo, interdit pour les 7 structurels —
  -- deux campagnes différentes sur le même produit doivent produire deux identités distinctes.
  constraint promo_id_coherent_avec_type check (
    (type_mission in ('anticiper_promo','revendre_promo','constater_promo') and promo_id is not null)
    or (type_mission not in ('anticiper_promo','revendre_promo','constater_promo') and promo_id is null)
  ),

  statut text not null default 'detectee' check (statut in (
    'detectee','a_preparer','presentee','accord_obtenu','en_attente',
    'refusee','commandee','mise_en_place','a_constater','reussie','abandonnee'
  )),

  -- état courant produit par le pipeline — dénormalisé pour un affichage sans jointure
  niveau_priorite text check (niveau_priorite in ('P1','P2','P3')),
  score integer,
  confiance text check (confiance in ('donnees_confirmees','recommandation_probable','information_a_verifier')),
  raisons_actuelles jsonb,  -- valide le schéma RaisonsActuelles (§8), version incluse dans le JSON
  score_calcule_at timestamptz,
  fingerprint text,          -- hash du résultat significatif (§6), pour l'idempotence des événements
  version_moteur text,       -- optionnel — diagnostic après changement de config des poids

  cycle integer not null default 1,
  derniere_reouverture_at timestamptz,

  cree_at timestamptz not null default now(),
  cloture_at timestamptz,
  prochaine_action_at date
);

create unique index opportunites_identite_promo
  on opportunites (magasin_id, produit_canonique_id, type_mission, promo_id) where promo_id is not null;
create unique index opportunites_identite_structurelle
  on opportunites (magasin_id, produit_canonique_id, type_mission) where promo_id is null;
```

### 3.2 Journal d'événements — append-only

```sql
create table opportunite_evenements (
  id uuid primary key default gen_random_uuid(),
  opportunite_id uuid not null references opportunites(id) on delete cascade,
  type text not null check (type in (
    'creation','recalcul_score','changement_statut','preuve_ajoutee',
    'preuve_retiree','reouverture','presentee','decision','commentaire','cloture'
  )),
  visite_id uuid references visites(id),
  score_a_ce_moment integer,
  raisons jsonb,
  statut_avant text,
  statut_apres text,
  raison_refus text,
  commentaire text,
  cree_par uuid references profiles(id),
  cree_at timestamptz not null default now()
);
```

Types d'événements distincts et non interchangeables : un changement de `statuts_produit_magasin` (`changement_statut`) n'est jamais confondu avec un recalcul de score par le moteur (`recalcul_score`), même s'ils peuvent se produire dans la même exécution du pipeline.

### 3.3 Preuves promo complémentaires — table interrogeable

```sql
create table opportunite_promos_preuves (
  opportunite_id uuid not null references opportunites(id) on delete cascade,
  promo_id uuid not null references promos(id) on delete cascade,
  ajoute_at timestamptz not null default now(),
  primary key (opportunite_id, promo_id)
);
```

Ouvert à **toutes** les opportunités, pas seulement structurelles : une mission `revendre_promo` sur l'opération YAOS de septembre peut citer l'opération YAOS de novembre comme argument complémentaire. La seule règle est qu'une opportunité ne peut pas citer sa propre promo principale comme preuve d'elle-même :

```sql
create or replace function verifier_preuve_promo_distincte()
returns trigger as $$
begin
  if exists (
    select 1 from opportunites
    where id = new.opportunite_id and promo_id = new.promo_id
  ) then
    raise exception 'Une opportunité ne peut pas citer sa propre promotion principale comme preuve complémentaire';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_verifier_preuve_promo_distincte
  before insert or update on opportunite_promos_preuves
  for each row execute function verifier_preuve_promo_distincte();
```

L'événement `preuve_ajoutee`/`preuve_retiree` garde le snapshot historique ; cette table représente l'ensemble des preuves **actuellement actives**.

### 3.4 Historique des relevés produit-magasin — indépendant des opportunités

```sql
create table statuts_produit_magasin_historique (
  id uuid primary key default gen_random_uuid(),
  magasin_id uuid not null references magasins(id),
  produit_id uuid not null references produits(id),  -- résolu canonique à l'écriture
  statut text not null check (statut in ('present','manquant','rupture')),
  raison_absence text,
  visite_id uuid references visites(id),
  signale_par uuid references profiles(id),
  signale_at timestamptz not null default now()
);

-- Idempotence par visite : plusieurs clics pendant la même visite mettent à jour
-- la même ligne au lieu d'en empiler plusieurs (§7).
create unique index historique_idempotence_visite
  on statuts_produit_magasin_historique (magasin_id, produit_id, visite_id) where visite_id is not null;
```

Une rupture s'enregistre même si aucune opportunité n'existe encore pour ce produit — cette table alimente la détection de récurrence (§4), elle ne dépend jamais du journal des opportunités. `lib/statuts/actions.ts`'s `updateStatutProduit` devra écrire ici en plus de son upsert actuel sur `statuts_produit_magasin` (upsert sur la clé `(magasin_id, produit_id, visite_id)` quand une visite est active, insert simple sinon).

## 4. Pipeline

Cinq étapes pures, dans cet ordre, jamais inversé — **le niveau P1/P2/P3 se fixe avant le score**, jamais l'inverse (voir §7 pour pourquoi c'est structurant).

### 4.1 Exclusion — dépendante du type de mission

Une exclusion n'est jamais globale à un produit : elle s'applique à des types de mission précis. Exemple validé : « produit déjà présent » peut exclure `referencer_produit` (rien à référencer), mais ne doit **jamais** exclure `revendre_promo`, `constater_promo`, `securiser_commande` ou `optimiser_implantation` — ces missions restent pertinentes sur un produit déjà en rayon.

| Condition | Types exclus |
|---|---|
| `statut_disponibilite` = `non_commandable` ou `arret_industriel` | tous |
| Hors plan de vente et sans canonique pertinent (`statut_catalogue = 'a_qualifier'`) | tous sauf `verifier_information` |
| Produit déjà `present`, sans promo ni engagement en cours | `referencer_produit` |
| Opportunité déjà `reussie`/`abandonnee`, aucun nouveau déclencheur (§7) | le type concerné uniquement |
| Promo au stade `constater`, déjà actionnée (opportunité `constater_promo` déjà `reussie`) | `constater_promo` sur cette promo |

### 4.2 Détection

Un ensemble de détecteurs purs, un par règle métier (section 6 de la spec utilisateur d'origine), produisant zéro ou plusieurs signaux :

```ts
interface SignalDetecte {
  typeMission: TypeMission
  promoId: string | null           // porte l'identité — deux campagnes distinctes produisent deux signaux distincts
  niveauDeclenche: 'P1' | 'P2' | 'P3'
  codeSignal: string                // ex. 'promo_active_non_constatee', 'top20_rupture_recurrente'
  sourceType: 'promo' | 'statut' | 'engagement' | 'vmh' | 'top' | 'typologie' | 'comparable' | 'historique_rupture'
  sourceId: string                  // id de la ligne source
  observedAt: string
  expiresAt: string | null
  force: number                     // contribution brute, avant agrégation en score
  donneesArgumentaire: Record<string, unknown>  // données brutes réutilisables dans un futur texte commercial
}
```

Détecteurs couverts par ce sous-projet : promo active non constatée, engagement échu (`prochaine_action_at` dépassée sur une opportunité `accord_obtenu`/`commandee`), permanent manquant + promo à J-28, échéance sous 7 jours, `ope_trade`, Top 20 en rupture récurrente (via §3.4), accord à sécuriser, action promise non exécutée.

**Seuil de récurrence** : « récurrente » = au moins 2 relevés `rupture` distincts (visites distinctes, cf. idempotence §8) sur les 60 derniers jours pour le même `(magasin, produit_canonique)`. Seuil isolé dans le même objet de configuration que la grille de score (§6), pas codé en dur dans le détecteur.

**Bloqué dans ce sous-projet** : les détecteurs dépendant de la typologie magasin (« produit attendu selon la typologie du magasin », modules MN/MD) — cette donnée n'existe pas encore (Phase 2 de la réconciliation produits, non livrée). Voir §9.

### 4.3 Classification P1/P2/P3

Généralisation de `candidatsPourProduit`/`meilleurCandidat` (`priorites.ts`) : applique les règles de niveau (section 6 de la spec d'origine) aux signaux détectés, retient le niveau le plus fort sans jamais sommer plusieurs signaux pour dépasser artificiellement un niveau.

### 4.4 Score

Extension de `scoring.ts` avec la grille validée (urgence ≤40, impact ≤25, pertinence ≤20, faisabilité ≤15, pénalités), poids isolés dans un objet de configuration testable (valeurs par défaut fournies par l'utilisateur ; édition admin hors scope, voir §9).

### 4.5 Confiance

- Signal direct et daté (promo active, engagement explicite) → `donnees_confirmees`.
- Inféré de signaux indirects (VMH, comparables) sans déclencheur direct → `recommandation_probable`.
- Signaux contradictoires → voir §4.6, jamais une affirmation sur l'opportunité d'origine.

### 4.6 Contradiction — opportunité séparée, jamais une reconversion

Une contradiction de données ne transforme **jamais** une opportunité existante en `verifier_information` — le type de mission représente l'action à accomplir, pas le niveau de confiance qu'on lui accorde. Le pipeline :
1. Crée (ou met à jour) l'opportunité d'origine normalement, mais force `confiance = 'information_a_verifier'`.
2. Crée en parallèle une opportunité **distincte** `type_mission = 'verifier_information'` (structurelle, `promo_id = null`), identifiée normalement via `(magasin, canonique, 'verifier_information')`, portant le détail de la contradiction dans ses raisons.

### 4.7 Rattachement — transactionnel, idempotent

Calcule la clé d'identité (`magasin_id, produit_canonique_id, type_mission[, promo_id]`), cherche une `opportunites` existante :

- **Absente**, doit exister → `insert` + événement `creation`.
- **Présente et ouverte** → recalcule fingerprint (hash canonique de `{niveau_priorite, score, confiance, raisons_actuelles, statut}`) ; si différent du fingerprint stocké, met à jour l'état courant + insère l'événement pertinent (`recalcul_score`, `changement_statut`...) + diff les preuves actives (`preuve_ajoutee`/`preuve_retiree`). **Si identique, aucune écriture** — le moteur peut tourner à chaque chargement de page sans spammer le journal.
- **Présente et close**, nouveau déclencheur réel (§7) → réouverture : `cycle += 1`, `statut → 'detectee'`, événement `reouverture`, historique conservé intact.
- **Présente et close**, pas de nouveau déclencheur (ou refus < 30 jours sans preuve nouvelle) → reste close, exclue de la génération.

Mise à jour de l'état courant + insertion d'événement(s) + diff des preuves s'exécutent **dans une seule transaction** — implémenté comme une fonction Postgres (`plpgsql`) appelée en RPC, pas comme plusieurs appels séquentiels côté client REST (le client Supabase-js ne garantit pas l'atomicité multi-requêtes, limite déjà documentée ailleurs dans ce projet pour `confirmerImportPlanDeVente`).

## 5. Réouverture et refus

Règle validée, indépendante du calcul de score (§4.4) :

- **N'est jamais un déclencheur de réouverture, seul** : changement de score, de VMH, de magasins comparables, de classement Top.
- **Est un vrai déclencheur** : une nouvelle promotion entrant dans sa fenêtre d'action, une nouvelle rupture observée, un engagement arrivé à échéance.
- Refus < 30 jours **sans** déclencheur réel → reste close.
- Refus < 30 jours **avec** un déclencheur réel → réouverture autorisée, mais le score hérite de la pénalité −25 (§6, empêche une remontée artificielle en tête de niveau).
- Une obligation opérationnelle P1 (promo active à constater, engagement échu) reste visible malgré un refus antérieur — le niveau P1/P2/P3 se calcule **avant** le score et n'est jamais modifié par une pénalité de refus, qui ne sert qu'à classer à l'intérieur d'un même niveau.

## 6. Grille de score (poids par défaut, isolés et testables)

| Composant | Plafond | Détail |
|---|---:|---|
| Urgence | 40 | promo à constater ou échéance ≤7j : 40 · promo <14j ou engagement à vérifier : 35 · promo 15-28j ou rupture récurrente : 25 · aucune échéance : 10 (le plus fort retenu, jamais sommé) |
| Impact commercial | 25 | ope_trade +15 · Top 20 +15 / Top 50 +10 / Top 70 +5 (exclusifs, jamais cumulés) · VMH très favorable jusqu'à +10 · bonne performance passée jusqu'à +5 |
| Pertinence magasin | 20 | attendu selon typologie +15 (bloqué §4.2/§9) · présent ≥70% comparables +10, 40-69% +6 · historique local positif +5 |
| Faisabilité | 15 | accord déjà obtenu +10 · commande/implantation promise +10 · emplacement identifié +5 · proposition simple +5 · moyen dispo +5 |
| Pénalités | — | refus <30j sans preuve nouvelle : exclusion (§5) · refus <30j avec preuve, réouverture : −25 · données peu fiables : −20 · picking sans preuve forte : −10 · non commandable/arrêté : exclusion (§4.1) |

## 7. Schéma des raisons (`raisons_actuelles`)

Pas de JSON libre — un schéma Zod versionné, validé côté application avant écriture :

```ts
export const RaisonSchema = z.object({
  version: z.literal(1),
  codeSignal: z.string(),
  source: z.object({ type: z.string(), id: z.string() }),
  observedAt: z.string(),
  fraicheur: z.enum(['fraiche', 'a_verifier', 'perimee']),
  contributionScore: z.number(),
  niveauDeclenche: z.enum(['P1', 'P2', 'P3']).nullable(),
  texteCommercial: z.string(),
})
export const RaisonsActuellesSchema = z.object({ version: z.literal(1), raisons: z.array(RaisonSchema) })
export type Raison = z.infer<typeof RaisonSchema>
export type RaisonsActuelles = z.infer<typeof RaisonsActuellesSchema>
```

`texteCommercial` porte déjà une phrase exploitable — la génération d'argumentaire structuré à 6 parties (constat/enjeu/preuves/demande/question/repli, section 15 de la spec d'origine) consommera ces raisons dans un sous-projet ultérieur, pas construite ici.

## 8. Historique des ruptures — idempotence par visite

« 3 ruptures observées lors de 4 visites sur 60 jours » se calcule directement sur `statuts_produit_magasin_historique` (§3.4), jamais sur le journal des opportunités. L'idempotence par `(magasin_id, produit_id, visite_id)` garantit que plusieurs clics pendant une même visite ne comptent qu'une fois. `updateStatutProduit` devra recevoir un `visiteId` optionnel (visite active en cours, si applicable) pour peupler cette table correctement — changement de signature à prévoir dans le plan d'implémentation.

## 9. Portée : ce sous-projet vs sous-projets suivants

**Livré ici** : schéma (§3), pipeline exclusion→détection→classification→score→confiance→rattachement (§4), règles de réouverture/refus (§5), grille de score par défaut (§6), schéma `Raison` (§7), historique des ruptures avec idempotence (§8). Fonctions pures, testées, sans nouvel écran.

**Hors scope, sous-projets suivants** :
- **Regroupement en missions affichées** — `opportunites` reste l'unité atomique (magasin + canonique + action) ; une « mission » commerciale (ex. 3 EAN YAOS absents → une seule carte « Développer le pavé YAOS ») est une couche de présentation qui consomme des opportunités existantes, pas construite ici. **Contrainte à respecter dans ce sous-projet suivant** : un regroupement devient un **snapshot persistant** dès qu'il est ajouté à une préparation de visite ou présenté en visite — il ne doit jamais être recalculé rétroactivement au point de perdre la trace de ce que le commercial a réellement montré au magasin.
- Écrans « Priorités de ma semaine », « Aujourd'hui », ouverture de visite (sections 1, 13, 18 de la spec d'origine).
- Génération d'argumentaire structuré 6 parties (section 15) — les `Raison.texteCommercial` existent pour l'alimenter, le générateur n'est pas construit.
- Interface admin d'édition des poids/fenêtres (section 20) — l'objet de config existe et est testable, pas d'écran pour l'éditer.
- Détecteurs dépendant de la typologie magasin par famille/segment et des modules MN/MD (§4.2) — bloqués tant que la déclaration de typologie magasin n'existe pas (Phase 2 de la réconciliation produits, non livrée).
- Saisie post-visite rapide (section 17) — les types d'événements (`decision`, `changement_statut`) existent comme mécanisme, l'écran n'est pas construit.

## 10. Tests requis

Repris de la liste originale de l'utilisateur, filtrés à ce qui est testable dans le périmètre de ce sous-projet (moteur + persistance, pas d'écran ni de regroupement) :

1. Produit permanent absent + promo prochaine sur EAN promo relié → une seule opportunité, identité résolue au canonique (pas de doublon EAN promo/canonique).
2. Promotion active non constatée → P1.
3. `ope_trade` renseigné → renforcement correct du score, jamais du niveau.
4. Top 20 absent sans promo → P2, sauf autre déclencheur P1.
5. Produit arrêté ou non commandable → exclusion totale, quel que soit le type de mission.
6. Produit déjà présent → exclut `referencer_produit`, n'exclut jamais `revendre_promo`/`constater_promo`/`securiser_commande`/`optimiser_implantation`.
7. Rupture récurrente Top 20 → P1, comptée sur `statuts_produit_magasin_historique` avec idempotence par visite (3 clics dans une même visite = 1 relevé).
8. Refus < 30 jours sans preuve nouvelle → reste close, aucune opportunité générée.
9. Nouvelle promotion entrant dans sa fenêtre après un refus → réouverture autorisée, score pénalisé de −25, niveau P1/P2/P3 non affecté par la pénalité.
10. Un changement de score/VMH/comparables/Top seul, après un refus, ne déclenche pas de réouverture.
11. Une obligation P1 (promo active à constater, engagement échu) reste visible malgré un refus antérieur sur ce produit.
12. Accord obtenu → opportunité persistante jusqu'au constat, ne disparaît pas et n'est pas recréée au chargement suivant.
13. Nouvelle visite → l'historique complet de l'opportunité (raisons initiales, événements passés) reste accessible.
14. Deux exécutions consécutives du pipeline sans changement de données → aucun nouvel événement `recalcul_score` (fingerprint identique).
15. Un changement significatif (niveau, score, confiance, statut, raisons ou preuves) → exactement un événement, jamais plusieurs pour la même exécution.
16. Donnée contradictoire → crée une opportunité `verifier_information` séparée, ne reconvertit jamais l'opportunité d'origine ; confiance de l'opportunité d'origine abaissée.
17. Preuve promo complémentaire ajoutée à une opportunité `revendre_promo` existante (ex. campagne de novembre citée en preuve pour la campagne de septembre) → acceptée dans `opportunite_promos_preuves`.
18. Tentative d'ajouter la promo principale d'une opportunité comme sa propre preuve complémentaire → rejetée par le trigger.
19. Calcul déterministe : mêmes données en entrée = même résultat de classification/score/confiance.
20. Magasins similaires réellement comparables uniquement (réutilise `magasinsSimilaires` existant, pas de nouvelle logique).
21. Action terminée (`reussie`/`abandonnee`) → disparaît des opportunités actives génération suivante, reste lisible via le journal d'événements.

**Non testables dans ce sous-projet** (dépendance bloquante documentée en §9, à ne pas simuler) : produit attendu selon la typologie du magasin absent → P2 forte ; produit de picking avec faible preuve → P3 ; module MN/MD inactif → pas de faux obligatoire. Ces trois tests entrent dans le sous-projet qui livrera la déclaration de typologie magasin.

## 11. Critères d'acceptation

1. Les 4 tables du §3 existent en base, contraintes et triggers appliqués et vérifiés (`promo_id` cohérent avec le type, trigger de preuve promo distincte, index d'idempotence par visite).
2. Le pipeline (§4) est implémenté comme fonctions pures testées, aucune n'accède directement à la base (les accès DB restent dans la couche d'orchestration/rattachement).
3. Le rattachement (§4.7) s'exécute de façon transactionnelle et idempotente — vérifié par un test d'exécution répétée sans changement de données.
4. Aucune régression sur `prioritesSemaine`/`chargerProduitsATravailler` existants — ce sous-projet ajoute un nouveau modèle en parallèle, ne remplace pas encore l'affichage actuel (le remplacement des écrans est un sous-projet suivant, §9).
5. Les 21 tests testables du §10 passent ; les 3 tests bloqués sont documentés comme tels, pas simulés avec des données inventées.
6. `raisons_actuelles` valide systématiquement `RaisonsActuellesSchema` avant toute écriture.
