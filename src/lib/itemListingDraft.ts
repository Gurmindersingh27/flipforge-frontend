// Local writing fields only. Never accept an assessment or saved record here.
export interface ListingDraftFields {
  title: string;
  description: string;
  dimensions: string;
  condition: string;
  defects: string;
  askingPrice: string;
  pickupArrangement: string;
}

export function emptyListingDraft(): ListingDraftFields {
  return { title: "", description: "", dimensions: "", condition: "", defects: "", askingPrice: "", pickupArrangement: "" };
}

export function listingPriceValid(value: string): boolean {
  return value.trim() === "" || /^\d+(\.\d{1,2})?$/.test(value.trim());
}

export function buildListingDraft(fields: ListingDraftFields): string {
  return [
    fields.title.trim(),
    fields.description.trim(),
    fields.dimensions.trim() && `Dimensions: ${fields.dimensions.trim()}`,
    fields.condition.trim() && `Condition: ${fields.condition.trim()}`,
    fields.defects.trim() && `Known defects: ${fields.defects.trim()}`,
    fields.askingPrice.trim() && listingPriceValid(fields.askingPrice) && `Asking price: $${fields.askingPrice.trim()}`,
    fields.pickupArrangement.trim() && `Pickup: ${fields.pickupArrangement.trim()}`,
  ].filter(Boolean).join("\n\n");
}
