import { formatItemMoney, parseItemNumber } from "./itemAnalysis.ts";
import { restoreItemForm } from "./savedItems.ts";
import type { ItemAnalyzeResponse, ItemAssessmentPhoto, ItemAssessmentRequest, ItemAssessmentResult } from "./types.ts";

export function newQuickItemForm() {
  // Explicit local cash-sale preset, disclosed beside the confirmation button.
  return restoreItemForm({ pickup: 0, delivery: 0, storage: 0, fee_fixed: 0, fee_pct: 0,
    hours: 0, hourly_value: 20, contingency_pct: .15, target_profit: 30 });
}
export function buildAssessmentRequest(id: string, description: string, asking: string, photos: ItemAssessmentPhoto[]): ItemAssessmentRequest {
  if (description.length > 500 || description.includes("\u0000") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(description)) {
    throw new Error("Use up to 500 characters and remove unsupported characters.");
  }
  if (photos.length < 1 || photos.length > 3) throw new Error("Add one to three photos first.");
  const price = parseItemNumber(asking, "purchase_price");
  // Omission lets the server extract the asking price from the description.
  return { request_id: id, description, photos, ...(price === null ? {} : { asking_price: price }) };
}
export function suggestedRepairTotal(result: ItemAssessmentResult): string {
  // Add normalized catalog cents only. The server does all offer/profit math.
  const cents = result.repair_suggestions.reduce((sum, repair) => sum + BigInt(repair.materials_cost.toFixed(2).replace(".", "")), 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
export function itemDecision(result: ItemAnalyzeResponse): string {
  const offer = result.low ? formatItemMoney(result.low.max_offer, true) : "";
  const price = result.assumptions.purchase_price.value;
  switch (result.status) {
    case "within_budget": return `Good buy at ${formatItemMoney(price)}.`;
    case "stretch": return result.low && result.low.max_offer >= 0 ? `Offer up to ${offer}.` : "The profit is too tight at this price.";
    case "skip": return `I'd pass at ${formatItemMoney(price)}.`;
    case "offer_only": return result.low && result.low.max_offer >= 0 ? `Offer up to ${offer}.` : "Even free is a tight flip.";
    case "needs_info": return "A couple of details first.";
  }
}

export async function prepareItemPhoto(file: File): Promise<ItemAssessmentPhoto> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP photo.");
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error("Choose a photo smaller than 15 MB.");
  const url = URL.createObjectURL(file);
  try {
    const picture = new Image();
    await new Promise<void>((resolve, reject) => { picture.onload = () => resolve(); picture.onerror = () => reject(new Error("That photo couldn't be opened. Try another.")); picture.src = url; });
    if (!picture.naturalWidth || picture.naturalWidth * picture.naturalHeight > 64_000_000) throw new Error("That photo is too large to process. Choose a smaller version.");
    const scale = Math.min(1, 1568 / Math.max(picture.naturalWidth, picture.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photos aren't supported in this browser. Use the manual estimate below.");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", .82).split(",")[1];
    if (!data || data.length > 4_194_304) throw new Error("That photo is still too large. Choose a smaller version.");
    return { media_type: "image/jpeg", data };
  } finally { URL.revokeObjectURL(url); }
}
