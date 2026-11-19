import {test} from 'node:test';
import assert from 'node:assert/strict';
import {costAllocation,measuredCoverage} from '../tools/lib/benchmark-cost-allocation.mjs';
test('pies reconcile all model and phase costs and refuse missing accounting',()=>{
  const row={receipt:{completeAccounting:true},completeModelAccounting:true,totalCost:{min:3,max:3},models:[{model:'opus',role:'plan',cost:{totalUsd:{min:2,max:2}}},{model:'haiku',role:'execute',cost:{totalUsd:{min:1,max:1}}}],phaseCosts:[{phase:'plan',model:'opus',totalCost:{min:2,max:2}},{phase:'implement',model:'haiku',totalCost:{min:1,max:1}}]};
  const allocation=costAllocation(row);assert.equal(allocation.available,true);assert.equal(allocation.parts.reduce((sum,p)=>sum+p.share,0),100);
  assert.equal(costAllocation(row,'phase').total,3);
  assert.equal(costAllocation({...row,completeModelAccounting:false}).available,false);
  assert.equal(costAllocation({...row,phaseCosts:[]},'phase').available,false);
  assert.equal(costAllocation({...row,totalCost:{min:4,max:4}}).available,false);
});
test('coverage distinguishes untested, legacy acceptance and minimum quality gates',()=>{
  const tasks=[{id:'A',name:'Task',level:'complex'}];
  const result=measuredCoverage(tasks,[{taskId:'A',arm:'haiku-solo',status:'accepted'},{taskId:'A',arm:'opus-sonnet-haiku-reviewed',status:'accepted',minimumStandard:{passed:true}}]);
  assert.equal(result.tasks[0].cells.find(c=>c.arm==='haiku-solo').minimumPassed,0);
  assert.equal(result.tasks[0].cells.find(c=>c.arm==='opus-sonnet-haiku').minimumPassed,1);
  assert.equal(result.tasks[0].cells.find(c=>c.arm==='sonnet-haiku').attempts,0);
});
