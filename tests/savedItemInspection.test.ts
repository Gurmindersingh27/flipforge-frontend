import test from 'node:test';
import assert from 'node:assert/strict';
import { captureInspection, emptyInspection, inspectionErrors, inspectionTextLength, isInspectionFacts, isItemInspection, sameInspection } from '../src/lib/savedItemInspection.ts';

const id = 'b0a51633-1c46-49f6-812a-99bf5bced7a2';
const previous = '527642ad-dbae-4e85-9516-764b61f17048';
const facts = () => ({...emptyInspection('chair'),label_text:'  <b>FO 123</b>\n ', notes:'\tA user observation\n', inspected_on:'2024-02-29'});
const response = () => ({id,root_item_id:1,previous_id:null,revision_number:1,schema_version:1,source:'user_reported',created_at:'2026-11-08T16:00:00+00:00',inputs:facts()});

test('All categories start unchecked with unknown text/date/brand; nothing is inferred', () => {
  for (const kind of ['chair','storage','general'] as const) {
    const value=emptyInspection(kind);
    assert.ok(isInspectionFacts(value));
    assert.deepEqual(Object.values(value.answers),Array(5).fill('unchecked'));
    for(const key of ['label_text','notes','inspected_on','brand_hint'] as const) assert.equal(value[key],null);
  }
});
test('Captured retry is detached, deeply frozen, and preserves exact text and predecessor', () => {
  const original=facts();const attempt=captureInspection(original,previous,id);const body=JSON.stringify(attempt);
  original.notes='later edit';original.answers['chair-height']='issue';
  assert.equal(JSON.stringify(attempt),body);
  assert.equal(attempt.expected_previous_id,previous);assert.equal(attempt.request_id,id);
  assert.ok(Object.isFrozen(attempt)&&Object.isFrozen(attempt.answers));
  assert.equal(attempt.label_text,'  <b>FO 123</b>\n ');
  assert.throws(()=>{attempt.answers['chair-height']='okay';});
});
test('Independent text limits match Unicode code points, preserve blanks and reject NUL', () => {
  assert.equal(inspectionTextLength('🪑'),1);
  assert.ok(isInspectionFacts({...facts(), label_text:'🪑'.repeat(500),notes:'x'.repeat(5000)}));
  assert.ok(isInspectionFacts({...facts(),label_text:'',notes:'  \n'}));
  for(const [key,value] of [['label_text','x'.repeat(501)],['notes','x'.repeat(5001)],['notes','a\0b'],['label_text',3]]) {
    const candidate={...facts(),[key]:value};assert.equal(isInspectionFacts(candidate),false);
  }
  assert.deepEqual(Object.keys(inspectionErrors({...facts(),notes:'x'.repeat(5001)})),['notes']);
});
test('Reject invalid dates without deriving an inspection date from save time', () => {
  for(const date of ['2025-02-29','2026-02-30','2026-13-01','2026-11-8','0000-01-01','2026-11-08T12:00:00Z',''])
    assert.equal(isInspectionFacts({...facts(),inspected_on:date}),false,date);
  assert.ok(isInspectionFacts({...facts(),inspected_on:null}));
});
test('Reject missing, extra, cross-category and invalid check answers and unsupported facts', () => {
  const value=facts();
  for(const inputs of [{...value,answers:{}},{...value,answers:{...value.answers,'storage-frame':'okay'}},{...value,answers:{...value.answers,'chair-frame':'good'}},
    {...value,kind:'storage'}, {...value,guide_version:'furniture-v2'}, {...value,extra:'anything'}, {...emptyInspection(),brand_hint:'steelcase'}, {...value,notes:undefined}])
    assert.equal(isInspectionFacts(inputs),false);
});
test('Validate identity, schema, source, revision chain, UTC date and entire normalized input', () => {
  const value=response(); assert.ok(isItemInspection(value,1));assert.equal(isItemInspection(value,2),false);
  for(const change of [{id:'bad'},{root_item_id:2},{schema_version:2},{source:'ai'},{revision_number:0},{revision_number:1.5},
    {previous_id:previous},{revision_number:2},{revision_number:2,previous_id:id},{created_at:'2026-02-30T00:00:00Z'},
    {created_at:'2026-11-08T00:00:00-05:00'},{inputs:{...facts(),notes:4}}])assert.equal(isItemInspection({...value,...change},1),false,JSON.stringify(change));
  assert.ok(isItemInspection({...value,revision_number:2,previous_id:previous},1));
});
test('Save confirmation compares every fact, independent of answer key order', () => {
  const value=facts();assert.ok(sameInspection(value,{...value,answers:Object.fromEntries(Object.entries(value.answers).reverse())}));
  for(const change of [{notes:'different'},{label_text:value.label_text.trim()},{inspected_on:null},{brand_hint:'steelcase' as const},
    {answers:{...value.answers,'chair-frame':'issue' as const}}])assert.equal(sameInspection(value,{...value,...change}),false);
});
