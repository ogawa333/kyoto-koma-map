import csv,json,subprocess,sys,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'runtime'),str(ROOT/'source/scripts')]
from predict import forest_score
import junction_experiment_features as features
import local_ai as ai

class HandoffTest(unittest.TestCase):
 def test_golden_feature_and_inference_parity(self):
  examples=json.loads((ROOT/'tests/golden.json').read_text());inputs=[x['input'] for x in examples]
  result=subprocess.run(['node',str(ROOT/'runtime/geometry.cjs')],input=json.dumps(inputs),text=True,capture_output=True,check=True)
  prepared=json.loads(result.stdout);model=json.loads((ROOT/'models/corrected-candidate/model.json').read_text())
  for e,p in zip(examples,prepared):
   self.assertNotIn('error',p);np.testing.assert_allclose(features.vectors(p['row'])['D'],e['features'],atol=1e-9,rtol=0)
   self.assertAlmostEqual(forest_score(model,e['features']),e['keepScore'],places=12);self.assertEqual(p['rule'],e['baseline'])
  cli=subprocess.run([sys.executable,str(ROOT/'runtime/predict.py')],input=json.dumps(inputs),text=True,capture_output=True,check=True)
  self.assertEqual(len(json.loads(cli.stdout)),len(examples))
 def test_all_historical_oof_scores_and_group_isolation(self):
  rows=json.loads((ROOT/'data/prepared-original-697.json').read_text())['rows'];by_key={r['key']:r for r in rows}
  with (ROOT/'experiments/original-697/predictions.csv').open(encoding='utf-8-sig') as f: predictions=list(csv.DictReader(f))
  groups=ai.components(rows,12)
  for i in range(1,6):
   folder=ROOT/f'experiments/original-697/fold-{i}';split=json.loads((folder/'split.json').read_text());train={r['key'] for r in split['train']};test={r['key'] for r in split['test']}
   self.assertFalse(train&test);self.assertEqual(train|test,set(by_key));self.assertTrue(all({rows[j]['key'] for j in g}<=train or {rows[j]['key'] for j in g}<=test for g in groups))
   model=json.loads((folder/'model-D.json').read_text())
   for p in predictions:
    if int(p['fold'])!=i:continue
    self.assertIn(p['key'],test);v=features.vectors(by_key[p['key']])['D'];self.assertAlmostEqual(forest_score(model,v),float(p['scoreD']),places=12)
 def test_binary_correction_is_only_one_label_change(self):
  old=json.loads((ROOT/'data/prepared-original-697.json').read_text())['rows'];new=json.loads((ROOT/'data/prepared-corrected-697.json').read_text())['rows']
  self.assertEqual(len(old),697);self.assertEqual(len(new),697)
  changed=[(a,b) for a,b in zip(old,new) if a['label']!=b['label']];self.assertEqual(len(changed),1)
  self.assertEqual(changed[0][1]['label'],'omit');self.assertEqual(sum(r['label']=='keep' for r in new),67)
 def test_invalid_geometry_is_retained(self):
  p=subprocess.run([sys.executable,str(ROOT/'runtime/predict.py')],input=json.dumps({'candidate':{},'target':{}}),text=True,capture_output=True,check=True)
  self.assertEqual(json.loads(p.stdout)['decision'],'keep')
if __name__=='__main__':unittest.main()
