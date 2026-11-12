import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'source/scripts'),str(ROOT/'runtime')]
import junction_experiment_features as f
from predict import forest_score
rows=json.loads((ROOT/'data/prepared-corrected-697.json').read_text())['rows'];model=json.loads((ROOT/'models/corrected-candidate/model.json').read_text())
# Representative lengths/counts, plus the two reviewed errors. No independent set8 inputs.
keys={json.loads((ROOT/'experiments/corrected-recount/label-correction.json').read_text())['geometryKey'],'baf6b617e6ff983b97f4f0f8763d501c1f96c4f61fd25d0c43bf3b3f92ee4b58'}
chosen=[r for i,r in enumerate(rows) if i%70==0 or r['key'] in keys]
examples=[]
for r in chosen:
 v=f.vectors(r)['D'];examples.append(dict(key=r['key'],input=dict(pair=r['pair'],entryIndex=r['entryIndex'],targetEntryIndex=r['targetEntryIndex']),features=v,keepScore=forest_score(model,v),baseline=r['rule']))
(ROOT/'tests/golden.json').write_text(json.dumps(examples,ensure_ascii=False,indent=2))
(ROOT/'example-pairs.json').write_text(json.dumps([x['input'] for x in examples[:2]],ensure_ascii=False,indent=2))
print('Golden fixtures:',len(examples))
