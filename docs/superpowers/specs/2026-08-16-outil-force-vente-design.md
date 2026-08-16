# Outil de préparation de visite — Force de vente Lactalis Ultra-frais France

Date : 2026-08-16
Statut : validé par l'utilisateur, en attente de revue finale avant passage au plan d'implémentation.

## 1. Contexte et objectif

Chaque commercial gère un secteur avec une liste de magasins qui lui est propre. Aujourd'hui la préparation de visite (quelles priorités, quels arguments, quoi vérifier) repose sur la mémoire et l'expérience individuelle, sans vue croisée du parc.

L'outil centralise trois sources de données (magasins, priorités produits, promos catalogue par enseigne) et les croise avec ce que chaque commercial observe sur le terrain (produits manquants/en rupture) pour :
- générer des arguments de vente contextualisés par magasin ("absent ici mais présent dans 7 magasins similaires", "promo le XX/XX, vous ne l'avez pas en rayon")
- calculer une priorité hebdomadaire par magasin et par secteur
- aider chaque commercial à construire sa tournée de la semaine en fonction de ces priorités

## 2. Utilisateurs et rôles

Trois rôles, contrôlés au niveau base de données (Row Level Security), pas seulement dans l'interface :

- **admin** — le chef de projet (utilisateur unique au départ). Seul rôle habilité à importer les données (magasins, priorités produits, promos). Gère les comptes utilisateurs (création, rôle, rattachement à un secteur ou à une équipe). Vue nationale complète.
- **manager** — lecture seule, limité aux secteurs des commerciaux qui lui sont rattachés (`manager_id`). Ne peut pas importer de données.
- **commercial** — accès à son propre secteur uniquement. Peut signaler les statuts produits en magasin et construire son planning de visite. Ne voit aucune donnée d'un autre secteur.

**Authentification** : lien magique par email (passwordless), sans dépendance à une validation IT préalable. L'admin invite chaque utilisateur (email + rôle + secteur/équipe). Une intégration SSO Azure AD (Microsoft 365, déjà utilisé en interne) pourra remplacer ce mécanisme plus tard si le projet est repris par la DSI — non nécessaire pour la v1.

## 3. Modèle de données

- **Utilisateur** — email, rôle (admin/manager/commercial), secteur (si commercial), manager rattaché (si commercial)
- **Secteur** — regroupe des magasins, assigné à un commercial
- **Magasin** — enseigne, format/taille, secteur, adresse, contact (nom, téléphone, email)
- **Produit** — référence, nom, catégorie
- **PrioritéProduit** — rang du produit (top 20/50/70), liste unique pour tout le parc, mise à jour périodiquement par import
- **Promo** — enseigne, produit(s) concerné(s), mécanique, trois jalons datés : `date_installation` (mise en rayon), `date_debut_vente`, `date_constat` (vérification terrain)
- **StatutProduitMagasin** — pour chaque couple (magasin, produit) : présent / manquant / rupture, avec qui l'a signalé et quand (dernier statut connu, pas un journal complet)
- **Visite** — magasin, commercial, semaine, jour, statut (`planifié` / `réalisé`) : trace le planning hebdomadaire et sert d'historique de visites réel une fois confirmée

Magasins et produits sont les pivots ; promos et priorités sont des attributs datés/rangés importés en bloc ; les statuts produits et le planning sont les seules données saisies manuellement, par les commerciaux.

## 4. Fonctionnalités

### Vue commercial

- **Fiche magasin** — infos, contact, statut de chaque produit. Pour un produit manquant : argumentaire généré automatiquement (magasins similaires qui l'ont en rayon, promo à venir ou récente sur ce produit dans cette enseigne).
- **Ma semaine** — planning par jour. Pendant la construction, une liste "priorités suggérées" (magasins avec alertes non couvertes) reste visible à côté pour guider le choix. Une fois la semaine posée, une alerte signale les priorités encore absentes du planning.
- Marquer une visite planifiée comme **réalisée**, avec possibilité de mettre à jour les statuts produits du magasin à ce moment-là.

### Vue manager

- Vue agrégée en lecture seule des secteurs de son équipe : mêmes priorités et alertes que la vue commercial, mais consolidées et filtrables par secteur/commercial. Pas d'import, pas de saisie.

### Vue admin

- Import des trois fichiers Excel/CSV (magasins, produits/priorités, promos).
- Gestion des utilisateurs (création, rôle, rattachement secteur/manager).
- Vue nationale complète (équivalent manager sans restriction de périmètre).

### Moteur de priorités (calcul serveur, aucune saisie manuelle)

Pour chaque magasin, croise `StatutProduitMagasin` (manquant/rupture) × `PrioritéProduit` × `Promo` (dates) pour générer les alertes :
- **Argument magasins similaires** — parmi les magasins jugés similaires (critère choisi par l'utilisateur : même enseigne, même taille, ou les deux), combien ont le produit manquant en rayon, à citer en argument.
- **Argument promo** — si une promo sur le produit manquant est à venir ou vient de passer dans cette enseigne, remonter la date et la mécanique.
- **Score de priorité** — combine le rang du produit (top 20 > 50 > 70) et l'urgence de la date promo la plus proche. Alimente la fiche magasin, le tableau de bord hebdo, et les suggestions de planning.

## 5. Import de données

L'admin dépose les fichiers Excel/CSV depuis l'interface. Pour chaque import :
- **Upsert** par identifiant naturel (ex: code magasin, code produit) — un réimport met à jour les enregistrements existants, ne duplique pas.
- **Validation ligne par ligne** — les lignes invalides (champ manquant, enseigne inconnue) sont listées dans un rapport d'erreurs après l'import ; les lignes valides sont importées quand même (pas de blocage tout-ou-rien sur une erreur isolée).

Le format exact des fichiers sources sera figé une fois les premiers exports réels fournis par l'utilisateur ; le modèle ci-dessus (section 3) sert de cible pour le mapping.

## 6. Stack technique et déploiement

- **Next.js** (frontend + API routes) — application web unique, responsive (mobile + desktop), pas d'app native.
- **Supabase** — Postgres (données relationnelles), authentification par lien magique, stockage de fichiers (imports), Row Level Security pour l'isolation des données par rôle/secteur.
- **Vercel** — hébergement du frontend/API.
- **Tailwind CSS** — mise en forme, pas de bibliothèque de composants surdimensionnée.

Dimensionnement cible : 50-200 commerciaux, 1000-5000 magasins — largement dans les capacités de cette stack sans optimisation particulière.

## 7. Tests

Pas de suite e2e pour la v1. Deux points concentrent la logique non triviale (branches, calcul) et méritent un test unitaire dédié :
- le moteur de score de priorité (rang produit + urgence date)
- le croisement "magasins similaires" (enseigne/taille/les deux)

Le reste (écrans, import, planning) est vérifié manuellement dans le navigateur sur les parcours clés (connexion, fiche magasin, construction de semaine, import admin) avant de considérer une itération terminée.

## 8. Hors périmètre v1

- Intégration SSO Azure AD / validation DSI (auth par lien magique suffit pour démarrer, migration possible plus tard sans changer le modèle de données)
- Connexion à un ERP/CRM interne (les données arrivent par fichier)
- Mode hors-ligne garanti en magasin (à évaluer si la connectivité terrain s'avère un vrai problème en usage réel)
- Journal d'audit complet des statuts produits (on garde le dernier statut connu, pas l'historique complet des changements)
