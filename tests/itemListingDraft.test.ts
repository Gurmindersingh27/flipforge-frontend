import test from 'node:test';
import assert from 'node:assert/strict';
import { buildListingDraft, emptyListingDraft, listingPriceValid } from '../src/lib/itemListingDraft.ts';

test('empty listing makes no claims; zero price is explicit, blank stays omitted', () => {
  assert.equal(buildListingDraft(emptyListingDraft()), '');
  assert.equal(buildListingDraft({ ...emptyListingDraft(), title: '  Chair  ', askingPrice: '0' }), 'Chair\n\nAsking price: $0');
});
test('only explicit public writing fields enter a listing', () => {
  const fields = { ...emptyListingDraft(), title: 'My chair', condition: 'Used', defects: 'Scratched seat',
    notes: 'PRIVATE negotiation maximum $30', listing_url: 'https://private.example/source',
    category: 'Antique teak', pickup: 40, resale_high: 200, repairs: 'Repaired',
    assessment: { item_name: 'Rare branded chair' } };
  assert.equal(buildListingDraft(fields), 'My chair\n\nCondition: Used\n\nKnown defects: Scratched seat');
});
test('buyer pickup and asking price come only from independently entered fields', () => {
  assert.equal(buildListingDraft({ ...emptyListingDraft(), dimensions: '20 x 18 x 34 inches', askingPrice: '65.50', pickupArrangement: 'Meet at agreed public location' }),
    'Dimensions: 20 x 18 x 34 inches\n\nAsking price: $65.50\n\nPickup: Meet at agreed public location');
});
test('price validation refuses malformed/negative values without inventing a price', () => {
  for (const value of ['-1', '1e3', 'Infinity', '$50', '12.345', '1,000']) {
    assert.equal(listingPriceValid(value), false);
    assert.equal(buildListingDraft({ ...emptyListingDraft(), askingPrice: value }), '');
  }
  for (const value of ['', '0', ' 12.50 ', '150']) assert.equal(listingPriceValid(value), true);
});
