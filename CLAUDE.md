# CLAUDE.md

Projet Nuxt 4 (dossier `app/`), Vue 3, TypeScript, SCSS (`sass`).

## Structure

- `app/components/` : composants Vue, préfixés `App` (ex. `AppHeader.vue`). Auto-importés par Nuxt, pas d'`import` manuel.
- `app/assets/main.scss` : styles globaux, chargé via `css` dans `nuxt.config.ts`. Importe les autres fichiers globaux avec `@use`.
- `app/assets/grid.scss` : grille 12 colonnes (`.container`, `.container__coll-12-1` à `.container__coll-12-12`).

## SCSS : centraliser, ne pas répéter

- Toute valeur réutilisable (couleur, espacement, taille de police, rayon, breakpoint, durée d'animation, z-index…) va dans une variable SCSS dans `app/assets/_variables.scss` (le créer s'il n'existe pas). Pas de valeur en dur dans les composants si une variable existe ou a du sens.
- Avant d'ajouter une valeur, vérifier si une variable équivalente existe déjà dans `_variables.scss` et la réutiliser.
- Dans les composants : `<style lang="scss" scoped>` et `@use "~/assets/variables" as *;` en tête du bloc style pour accéder aux variables.
- Un bloc de styles répété dans plusieurs endroits devient un `@mixin` dans `app/assets/_mixins.scss` (le créer si besoin), ou une classe utilitaire globale.
- Nommage des classes en BEM : `bloc__element--modificateur`, le bloc portant le nom du composant en kebab-case (ex. `.app-header`, `.app-header__title`).
- Exception : les classes de la grille (`grid.scss`) et autres classes utilitaires sont écrites en entier, une par une, sans `@for`/`@each`/fonction SCSS, pour que l'autocomplétion de l'IDE les trouve. Les valeurs à l'intérieur peuvent quand même utiliser des variables.

## TypeScript

- Tout le code est en TypeScript : `<script setup lang="ts">` dans les composants, fichiers `.ts` pour composables, utils, stores, server.
- Pas de `any`. Si un type est vraiment inconnu, utiliser `unknown` et le restreindre (type guard, `typeof`, `in`, validation). Pas de `as any` ni de `// @ts-ignore` pour contourner une erreur : corriger le type.
- Props et emits typés par génériques : `defineProps<{ title: string }>()`, `defineEmits<{ select: [id: number] }>()`. Valeurs par défaut via `withDefaults` ou la déstructuration réactive des props.
- Typer les `ref` quand l'inférence ne suffit pas : `ref<User | null>(null)`.
- Types et interfaces partagés dans `app/types/` (ex. `app/types/user.ts`), exportés et importés là où ils servent, plutôt que redéfinis dans chaque fichier.
- Typer les retours de `useFetch` / `$fetch` : `useFetch<User[]>('/api/users')`.
- Vérifier les types avec `npx nuxi typecheck` (nécessite `vue-tsc` et `typescript` en devDependencies) avant de considérer une tâche terminée.
