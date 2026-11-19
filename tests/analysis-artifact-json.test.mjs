import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAnalysisArtifact,analysisSchema} from '../tools/lib/analysis-artifact-json.mjs';
test('parses native JSON artifacts through Markdown without evaluating or accepting truncation',()=>{
  const value={summary:'A string with braces { and } and a quote "',tasks:[],currentFlows:[],risks:[]};
  const text=JSON.stringify(value);
  assert.deepEqual(parseAnalysisArtifact(text),value);
  assert.deepEqual(parseAnalysisArtifact('Here is the plan:\n```json\n'+text+'\n```\nEnd.'),value);
  assert.equal(parseAnalysisArtifact(text.slice(0,-1)),null);
  assert.equal(parseAnalysisArtifact('{"summary":"not enough"}'),null);
  assert.equal(parseAnalysisArtifact('process.exit()'),null);
  assert.ok(analysisSchema.required.includes('testPlan'));
});
