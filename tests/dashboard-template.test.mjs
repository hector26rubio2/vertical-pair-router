import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDashboardDocument} from '../tools/lib/benchmark-dashboard-template.mjs';

test('standalone report template keeps local styles, script, content and escaped configuration',()=>{
  const html=renderDashboardDocument({report:{tasks:[],rows:[]},summary:{at:'fixture',totalObservedTokens:0,totalReferenceUsd:{min:0,max:0}},orderedTasks:[],sections:'<section id="fixture">Evidence</section>',verdicts:[],armLabel:x=>x,campaignPanel:'',profile:{policy:{allowedProviders:['<script>']},orchestration:{}},configured:'',comparisonTable:'<table id="ledger-fixture"></table>',claudePrices:{cards:[],checkedAt:'fixture'},openaiPrices:{cards:[],checkedAt:'fixture'},priceRows:'',openaiRateRows:'',routingPanel:''});
  assert.match(html,/id="fixture"/);assert.match(html,/id="ledger-fixture"/);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/<style>[\s\S]*\.toolbar/);
  assert.match(html,/<script>[\s\S]*hashchange/);
  assert.doesNotMatch(html,/<script[^>]+src=/);
});
