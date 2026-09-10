import type { RehabScope, RehabScopeItem } from "./types.ts";

export function lineTotal(item: RehabScopeItem): number {
  return Math.round((item.quantity * item.unit_cost + Number.EPSILON) * 100) / 100;
}

export function scopeTotals(scope: RehabScope) {
  const subtotal = Math.round(scope.items.reduce((sum, item) => sum + lineTotal(item), 0) * 100) / 100;
  const total = Math.round((subtotal * (1 + scope.contingency_pct)) + Number.EPSILON);
  return { subtotal, contingency: total - subtotal, total };
}

export function newScope(amount = 0): RehabScope {
  return { version: 1, contingency_pct: 0, notes: "", items: amount > 0 ? [{
    id: crypto.randomUUID(), category: "General rehab", description: "Existing planning allowance — replace with itemized scope",
    quantity: 1, unit: "allowance", unit_cost: amount, basis: "allowance", source: "User allowance", quote_date: null, notes: "",
  }] : [] };
}

export function scopeError(scope: RehabScope | null, budget?: number | null): string | null {
  if (!scope) return null;
  if (!Number.isFinite(scope.contingency_pct) || scope.contingency_pct < 0 || scope.contingency_pct > 1) return "Contingency must be between 0% and 100%.";
  if (scope.items.length > 100) return "Use no more than 100 scope items.";
  if (new Set(scope.items.map(item => item.id)).size !== scope.items.length) return "Scope item IDs must be unique.";
  for (const item of scope.items) {
    if (!item.category.trim()) return "Each scope item needs a category.";
    if (![item.quantity, item.unit_cost].every(n => Number.isFinite(n) && n >= 0) || item.quantity > 1000000 || item.unit_cost > 100000000) return "Enter valid non-negative quantities and unit costs.";
    if (item.basis === "quote") {
      if (!item.source.trim() || !item.quote_date) return "Each quoted item needs a source and quote date.";
      const date = new Date(`${item.quote_date}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== item.quote_date) return "Enter a valid quote date.";
    }
  }
  if (budget != null && Math.abs(scopeTotals(scope).total - budget) > 0.001) return "Apply the itemized scope total before analyzing, or switch to a lump-sum budget.";
  return null;
}

export function captureScope(scope: RehabScope | null | undefined): RehabScope | null {
  if (!scope) return null;
  const copy = structuredClone(scope);
  copy.items.forEach(Object.freeze);
  Object.freeze(copy.items);
  return Object.freeze(copy);
}
