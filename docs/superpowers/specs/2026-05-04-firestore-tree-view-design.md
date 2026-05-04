# Firestore Tree View — Design Spec

**Date:** 2026-05-04
**Status:** Draft — awaiting review
**Approach:** A — Toggle arbre/table dans TabQueryEditor

## Overview

Ajouter une vue arbre alternative pour visualiser les données Firestore dans Beekeeper Studio, inspirée de Firefoo. Deux cas d'usage : explorateur de collections/documents (sans requête) et vue alternative pour les résultats de requêtes. L'arbre a une profondeur maximale de 3 niveaux (collection → documents → champs). Les sous-collections sont affichées comme noms uniquement, sans expansion.

## Architecture

```
TabQueryEditor.vue (modifié)
├── EditorToolbar
│   └── [toggle: Grid | Tree]          ← nouveau, firestore seulement
├── QueryTextEditor (CodeMirror)
└── Zone de résultats
    ├── ResultTable.vue (existant)     ← mode 'grid'
    └── FirestoreTreeView.vue (nouveau) ← mode 'tree'
        └── FirestoreTreeNode.vue (nouveau, rendu récursif)
```

### Nouveaux composants

**`FirestoreTreeView.vue`** — Conteneur principal
- Reçoit en props : `connection`, `columns`, `rows`, `mode` ('explorer' | 'results')
- Mode explorer : charge les collections racine via `connection.listTables()` (retourne `TableOrView[]`, chaque item a `.name` = collection ID), puis lazy-load les documents via `connection.selectTop(collectionName, offset, limit, [], [])` à l'expand
- Mode results : transforme les `rows` en nœuds d'arbre
- Gère les états : chargement, erreur, vide
- Utilise `vue-virtual-scroll-list` pour la virtualisation des grandes listes
- Délégue le rendu individuel à `FirestoreTreeNode.vue`

**`FirestoreTreeNode.vue`** — Rendu d'un nœud (profondeur max 3)
- Affiche : chevron, icône (📁 collection, 📄 document, 🔑 champ), label, valeur
- Indentation par niveau (padding-left)
- Expand/collapse avec lazy loading des enfants
- Double-clic sur valeur primitive → édition inline
- Valeurs complexes (objets, tableaux) → JSON tronqué, non-expansible au niveau 3

### Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `apps/studio/src/components/editor/FirestoreTreeView.vue` | Nouveau |
| `apps/studio/src/components/editor/FirestoreTreeNode.vue` | Nouveau |
| `apps/studio/src/components/TabQueryEditor.vue` | Ajout toggle + intégration conditionnelle |
| `apps/studio/src/lib/db/clients/firestore.ts` | Aucune modification nécessaire — `listTables()`, `selectTop()`, `executeApplyChanges()` existent déjà |

## Modèle de données

```typescript
interface FirestoreTreeNode {
  id: string;                    // identifiant unique
  type: 'collection' | 'document' | 'field' | 'subcollection-list';
  label: string;                 // nom affiché
  collectionName?: string;       // nom de la collection parente
  docId?: string;               // ID du document parent
  value?: unknown;              // valeur brute
  displayValue: string;         // représentation affichable
  fieldType?: string;           // type Firestore (string, number, boolean, timestamp, geopoint, reference, map, array, null, binary)
  children?: FirestoreTreeNode[];
  childCount?: number;          // compteur pour lazy loading
  expanded: boolean;
  loading: boolean;
  level: number;                // 0=collection, 1=document, 2=field
  isEditable: boolean;          // true pour primitives au niveau 2
}
```

### Transformation des données

- **Explorer :** `connection.listTables()` → nœuds `type: 'collection'` (niveau 0). Expand → `connection.selectTop(collectionName, cursor, 50, [], [])` → nœuds `type: 'document'` (niveau 1). Expand → champs du document → nœuds `type: 'field'` (niveau 2). Pagination via `pageState` cursor retourné par `selectTop`
- **Résultats :** Chaque ligne de résultat → nœud `type: 'document'`. Si présence d'une colonne `__collection__`, groupement par collection comme nœud `type: 'collection'`
- **Sous-collections :** Nœud `type: 'subcollection-list'` sous le document, affichant les noms des sous-collections sans expansion (pas de documents enfants)

## Toggle arbre/table

- Emplacement : barre d'outils au-dessus de la zone de résultats (à côté de "Edit Data", "Download")
- Affichage conditionnel : `connection.connectionType === 'firestore'`
- État local : `viewMode: 'grid' | 'tree'` (défaut `'grid'`), persiste par onglet
- Pas de re-exécution de requête au changement de mode — les données existantes sont réutilisées

## Modes

### Mode explorateur
- Déclenché quand `rows` est vide (pas de résultat de requête)
- Appel initial à `connection.listTables()` pour les collections racine (retourne `TableOrView[]`, `.name` = collection ID)
- Chaque collection affiche un compteur de documents (chargé lazy)
- Expand collection → charge 50 premiers documents, scroll bas → pagination "Load More"
- Expand document → affiche les champs du document
- Barre de recherche pour filtrer les collections par nom
- Bouton Refresh pour recharger

### Mode résultat de requête
- Déclenché quand `rows` contient des données
- Transformation directe des lignes en nœuds (pas de lazy loading)
- Toggle arbre↔grille préserve l'ordre et le filtrage
- Retour au mode explorer si les résultats sont effacés

## Édition inline

- **Nœuds éditables :** Champs niveau 2 avec valeur primitive (string, number, boolean, null, timestamp, geopoint, reference)
- **Interaction :** Double-clic → input adapté au type → Enter/blur valide, Escape annule
- **Types spéciaux :**
  - Timestamp → deux inputs date/heure
  - Geopoint → deux inputs latitude/longitude
  - Boolean → toggle checkbox
  - Null → select avec options de type
  - Reference → affichage `→ /collection/docId`, pas d'édition
- **Pipeline :** `FirestoreTreeNode` → emit `edit-start` → `FirestoreTreeView` → après validation → emit `edit-cell` → `TabQueryEditor` → `connection.executeApplyChanges({ updates: [{ table: collectionName, column: fieldName, value: newValue, primaryKeys: [{ column: '__name__', value: docId }] }] })`
- **Erreurs :** Toast + retour à la valeur précédente en cas d'échec (permissions, réseau)
- **Pendant sauvegarde :** spinner sur le nœud

## États et cas limites

### Loading states
- Premier chargement → skeleton tree (3-4 lignes grises)
- Expand nœud → spinner inline sur le parent
- Sauvegarde édition → spinner sur la valeur
- Pagination → loader en bas de liste

### Cas limites
- **Collection vide :** nœud avec message "Aucun document", compteur 0
- **Document vide :** nœud avec message "Document vide"
- **Grand nombre de collections (>500) :** virtualisation + barre de recherche
- **Données binaires :** `[Binary: N bytes]`, non éditable
- **Références :** `→ /collection/docId`, non éditable
- **Subcollections :** nœud `Subcollections (3)` avec noms listés sans expansion

### Erreurs
- `listTables()` échoue → message d'erreur + bouton retry dans l'arbre
- Chargement documents échoue → icône erreur sur le nœud collection
- Édition échoue → toast + retour valeur précédente
- Timeout → spinner indéfini annulable

## Performance

- **Virtualisation :** Utilisation de `vue-virtual-scroll-list` (déjà dans le projet) pour les grandes listes de nœuds
- **Pagination :** 50 documents par page en mode explorer
- **Lazy loading :** Les enfants sont chargés uniquement à l'expand, pas au montage
- **Mémoire :** Les nœuds sont aplanis dans un tableau comme dans `entity-list/treeItems.ts`

## Accessibilité

- Navigation clavier : ↑↓ pour déplacement, → pour expand, ← pour collapse, Enter pour éditer
- Rôles ARIA : `role="tree"` sur le conteneur, `role="treeitem"` sur chaque nœud
- `aria-expanded`, `aria-level`, `aria-setsize`, `aria-posinset` sur les nœuds

## Non-inclus (v1)

- Drag & drop de documents entre collections
- Gestion de conflits d'édition (last write wins pour la v1)
- Vue arbre pour d'autres bases NoSQL (MongoDB)
- Export de l'arbre
- Raccourcis clavier globaux pour le toggle
- Thèmes spécifiques à l'arbre (réutilisation des thèmes SCSS existants)
