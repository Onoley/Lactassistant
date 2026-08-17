# Fondations du moteur — priorité hebdomadaire vs importance produit

Date : 2026-08-17
Statut : validé par l'utilisateur, en attente de revue finale avant passage au plan d'implémentation.
Sous-projet 1 sur 5 (voir §7 Hors périmètre) de la refonte de la logique métier centrale de Lactassistant.

## 1. Contexte

Le moteur existant (`lib/engine/scoring.ts`, `priorites.ts`, `arguments.ts`, `fiche-magasin.ts`) calcule un unique score additif (rang Top20/50/70 + urgence de promo + présence chez des magasins similaires) et l'utilise indifféremment pour trier la liste "Ma semaine"/"Mon équipe" *et* pour classer les produits sur une fiche magasin. Ce doublon est la source du problème signalé : un produit simplement bien classé ou bien représenté chez des comparables peut faire remonter un magasin comme "prioritaire cette semaine" alors qu'aucune action datée ne le justifie.

Constats issus de l'analyse du code et du schéma actuels :
- `magasins` n'a pas de champ `surface` (présent dans le fichier source, jamais importé — hors périmètre ici, voir §7).
- `produits` / `produits_enseigne` n'ont aucun statut de disponibilité — à créer.
- Cliquer sur une visite planifiée dans "Ma semaine" ne mène nulle part aujourd'hui (pas de lien vers la fiche magasin) — hors périmètre ici (sous-projet 3), mais ce sous-projet doit produire les données dont cette synthèse aura besoin.
- Le champ `promos.date_constat` existe en base mais n'est plus renseigné depuis l'import réel (voir migration `0003_promos_reel.sql`) ; le cycle promo décrit ci-dessous ne s'appuie donc pas dessus.

## 2. Objectif de ce sous-projet

Séparer strictement, dans le moteur, deux notions aujourd'hui confondues :

1. **Priorité hebdomadaire** — ce qui doit être traité *cette semaine* parce que c'est daté ou urgent (promo proche, Opé Trade, rupture).
2. **Importance d'un produit dans une fiche magasin** — ce qui aide à hiérarchiser *quoi pousser* une fois sur place (rang Top70, magasins comparables), sans jamais créer d'urgence hebdomadaire à lui seul.

Ce sous-projet livre le moteur (fonctions pures, testées) et le strict minimum de câblage pour que les pages existantes continuent de fonctionner avec les nouvelles fonctions. Il ne livre pas de nouvelle interface (voir §7).

## 3. Modèle de données

Un seul changement de schéma :

```sql
alter table produits_enseigne
  add column statut_disponibilite text not null default 'commandable'
  check (statut_disponibilite in ('commandable', 'non_commandable', 'arret_industriel', 'en_attente_referencement'));
```

Décision validée : le statut est **par enseigne**, y compris "arrêt industriel" (pas de champ global sur `produits`), pour permettre à l'admin de le corriger enseigne par enseigne sans attendre une confirmation nationale.

Édition : ajout d'un sélecteur sur la page `/admin/produits` existante, dans la même cellule que les cases à cocher d'assortiment par enseigne (une case cochée peut avoir un statut ; une case décochée n'a pas de ligne `produits_enseigne` donc pas de statut à éditer).

Aucun autre champ n'est ajouté. Le cycle promo (§5) se déduit des dates déjà présentes sur `promos`.

## 4. Découpage du moteur

Remplace `calculerPrioritesMagasins` (qui reste supprimé, pas de wrapper de compatibilité) par trois fonctions pures dans `lib/engine/` :

### 4.1 `stadePromo(promo, aujourdHui) → StadePromo`

```ts
type StadePromo = 'anticiper' | 'revendre' | 'controler' | 'constater'
```

Dérivé uniquement des dates existantes :
- avant `date_installation` (ou, si `date_installation` est `null`, plus de 21 jours avant `date_debut_vente`) → `anticiper`
- entre `date_installation` (ou 21 jours avant `date_debut_vente` si `date_installation` est `null`) et `date_debut_vente` → `revendre`
- entre `date_debut_vente` et `date_fin_vente` (ou indéfiniment si `date_fin_vente` est `null`) → `controler`
- après `date_fin_vente` → `constater`

### 4.2 `prioritesSemaine(magasins, statuts, produitsEnseigne, promosParProduitId, aujourdHui?) → PrioriteHebdo[]`

```ts
type NiveauPriorite = 'urgent' | 'cette_semaine' | 'a_anticiper'

interface PrioriteHebdo {
  magasin: Magasin
  produit: Produit
  niveau: NiveauPriorite
  raison: string            // phrase complète, prête à afficher
  stadePromo: StadePromo | null
  promo: Promo | null
  actionRecommandee: ActionRecommandee   // voir §6
}
```

Règle de déclenchement (une entrée n'est produite QUE si une de ces conditions est vraie — un simple rang élevé ou une forte présence chez des comparables ne suffit jamais) :

- `statut === 'rupture'` → toujours une entrée, niveau minimum `cette_semaine` (indépendamment de toute promo).
- `statut ∈ {'manquant', 'rupture'}` **et** une promo (non-OP-Trade) existe pour ce produit dans l'enseigne du magasin → une entrée, quel que soit le stade. Le niveau dépend de l'échéance : `urgent` si ≤ 7 jours, `cette_semaine` si ≤ 14 jours, `a_anticiper` au-delà.
- Une promo **OP Trade** existe pour ce produit dans l'enseigne du magasin → une entrée **quel que soit le statut produit** (présent compris), niveau `urgent` systématiquement. Une Opé Trade se suit tout du long (revendre l'accord, contrôler présence/stock/prix/implantation, constater), pas seulement quand le produit manque au départ.
- Stade `constater` : ne génère une entrée que si la promo est OP Trade **ou** le produit est toujours `manquant`/`rupture` à ce magasin (sinon rien à négocier ni à vérifier, pas de bruit inutile).
- Aucune autre condition ne déclenche d'entrée : un Top 20 manquant sans promo ni rupture n'apparaît jamais ici.
- Un même (magasin, produit) ne produit qu'**une seule** entrée même si plusieurs promos s'appliquent : celle qui donne le niveau le plus élevé est retenue (`urgent` > `cette_semaine` > `a_anticiper`), à égalité la plus proche dans le temps.

Note : le seuil de repli "21 jours avant `date_debut_vente`" (utilisé par `stadePromo` quand `date_installation` est inconnue) et les seuils 7/14 jours ci-dessus sont des valeurs par défaut raisonnables, cohérentes avec les seuils déjà utilisés par `scoreUrgenceDate` — à ajuster avec le retour terrain, comme le reste des poids du moteur (cf. commentaire `ponytail:` existant dans `scoring.ts`).

`raison` est une phrase complète construite à partir des faits (produit, promo, dates, stade), jamais un score brut — ex. *"Rupture signalée — aucune promo en cours."*, *"Promo OP Trade '3 pour 2' chez Carrefour : installation le 12/10, dans 4 jours."*, *"Promo terminée le 30/09 — produit toujours manquant, à négocier."*

### 4.3 `importanceProduitFiche(magasin, produit, statut, magasinsComparables, statutsComparables, promosDuProduit, critere, aujourdHui?) → ImportanceProduit`

```ts
interface ImportanceProduit {
  score: number              // usage interne uniquement, jamais affiché tel quel — sert à trier une fiche
  raisons: string[]          // faits qui justifient le classement, en phrases
  presentsChezComparables: { total: number; presents: number }
  promo: { promo: Promo; stade: StadePromo } | null
}
```

Reprend la logique déjà en place (rang Top70 + magasins comparables du même secteur + promo si présente sur le produit) sans changement de règle de calcul — seul le découpage change : cette fonction ne sert plus jamais à trier "Ma semaine"/"Mon équipe", uniquement à ordonner les produits d'une fiche magasin (le rendu réel de cette liste est le sous-projet 2).

## 5. Action recommandée et verrou "non commandable"

```ts
type ActionRecommandee =
  | 'faire_entrer'
  | 'securiser_commande'
  | 'preparer_implantation'
  | 'verifier_participation'
  | 'tester'
  | 'preparer_dossier_referencement'
  | 'aucune_action_commande'

function actionRecommandee(
  statutDisponibilite: StatutDisponibilite,
  stadePromo: StadePromo | null,
  statutProduitMagasin: StatutProduit
): ActionRecommandee
```

Règle dure, garantie par les tests (§8) :
- `statutDisponibilite ∈ {'non_commandable', 'arret_industriel'}` → **toujours** `'aucune_action_commande'`, quel que soit le stade ou le statut magasin. Aucune autre valeur n'est possible.
- `statutDisponibilite === 'en_attente_referencement'` → **toujours** `'preparer_dossier_referencement'`.
- `statutDisponibilite === 'commandable'` → dépend du stade promo et du statut magasin (ex. `anticiper`+`manquant` → `faire_entrer` ; `revendre` → `securiser_commande` ; `controler` → `verifier_participation` ; pas de promo mais présent chez des comparables → `tester` ; `constater` → `verifier_participation` si encore manquant).

## 6. Câblage minimal des pages existantes (pas de nouvelle UI)

- `app/semaine/page.tsx` et `app/equipe/page.tsx` : appellent `prioritesSemaine` au lieu de `calculerPrioritesMagasins`. Affichage minimal (le rendu riche est le sous-projet 3) : `raison` à la place de `raisons.join(', ')`, `niveau` à la place de `score`.
- `lib/engine/fiche-magasin.ts` : appelle `importanceProduitFiche` au lieu de `genererArguments` pour le tri ; le rendu détaillé (section "produits à travailler", argumentaire complet) reste le sous-projet 2 — pour ce sous-projet, la fiche magasin garde son affichage actuel, seule la fonction sous-jacente change.
- `lib/types.ts` : ajoute `StatutDisponibilite`, étend `ProduitEnseigne` avec `statut_disponibilite`.

## 7. Hors périmètre (sous-projets suivants, non traités ici)

2. Fiche magasin enrichie (section "produits à travailler", argumentaire complet par produit, questions de découverte).
3. Page de synthèse au clic sur une visite planifiée.
4. Magasins comparables enrichis (champ `surface`, zone de chalandise, typologie).
5. Import et affichage des données VMH comme repère informatif.

## 8. Tests requis

- `actionRecommandee` : pour chaque combinaison de `statutDisponibilite` × `stadePromo` × `statutProduitMagasin`, jamais de valeur de commande (`faire_entrer`/`securiser_commande`/`tester`) quand `statutDisponibilite` est `non_commandable` ou `arret_industriel`.
- Un produit Top 20, présent chez de nombreux magasins comparables, sans promo ni rupture : absent de `prioritesSemaine`, mais premier dans `importanceProduitFiche` pour ce magasin.
- Rupture sans promo associée → présent dans `prioritesSemaine` avec niveau `cette_semaine` minimum.
- Promo OP Trade sur un produit manquant → niveau `urgent`, indépendamment de l'échéance.
- Promo OP Trade sur un produit déjà `present` → entrée quand même générée (à contrôler), niveau `urgent`.
- Stade `constater` : absent de `prioritesSemaine` si la promo n'est pas OP Trade et que le produit est `present` ; présent sinon.
- `stadePromo` : couverture des 4 stades avec et sans `date_installation` connue (repli sur les 21 jours avant `date_debut_vente`).
