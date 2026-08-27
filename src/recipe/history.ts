import { cloneRecipe } from "./defaults";
import type { EditRecipe } from "./types";

const MAX = 50;

export type RecipeHistory = {
  past: EditRecipe[];
  present: EditRecipe;
  future: EditRecipe[];
};

export function initHistory(present: EditRecipe): RecipeHistory {
  return { past: [], present: cloneRecipe(present), future: [] };
}

export function pushHistory(history: RecipeHistory, next: EditRecipe): RecipeHistory {
  if (recipesEqual(history.present, next)) return history;
  const past = [...history.past, cloneRecipe(history.present)];
  if (past.length > MAX) past.shift();
  return { past, present: cloneRecipe(next), future: [] };
}

export function undo(history: RecipeHistory): RecipeHistory {
  if (history.past.length === 0) return history;
  const past = [...history.past];
  const present = past.pop()!;
  return {
    past,
    present,
    future: [cloneRecipe(history.present), ...history.future],
  };
}

export function redo(history: RecipeHistory): RecipeHistory {
  if (history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return {
    past: [...history.past, cloneRecipe(history.present)],
    present,
    future,
  };
}

export function recipesEqual(a: EditRecipe, b: EditRecipe): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
