"""Feature semantics and inner-only selection checks for the experimental AI."""
import copy
import json
import hashlib
import math
from pathlib import Path
import sys
import unittest
import tempfile
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import junction_experiment_features as features
import run_junction_ablation as experiment
import evaluate_frozen_junction as frozen


def sample():
    def frame():
        center=dict(lat=35,lon=135)
        branches=[[center,dict(lat=35+math.cos(a)*28/111320,lon=135+math.sin(a)*28/111320/math.cos(math.radians(35)))] for a in (math.pi,0,math.pi/2)]
        return dict(center=center,heading=0,branches=branches)
    signature=[[math.pi,math.pi],[0,0],[math.pi/2,math.pi/2]]
    return dict(signatures=[copy.deepcopy(signature),copy.deepcopy(signature)],pair=dict(modelInput=dict(candidate=frame(),target=frame())),entryIndex=0,targetEntryIndex=0)


class ExperimentTest(unittest.TestCase):
    def test_features_are_additive_and_ignore_answers_rules_ids_and_exit_routes(self):
        row=sample();first=features.vectors(row)
        self.assertEqual([len(first[s]) for s in 'ABC'],[147,186,350])
        self.assertEqual(first['B'][:147],first['A']);self.assertEqual(first['C'][:186],first['B'])
        row.update(label='keep',rule='omit',groups=['private'],evaluator='P001')
        row['pair'].update(rulePrediction='keep',responses=[dict(choice='indistinguishable')])
        row['pair']['modelInput']['candidate']['routeOut']=[dict(lat=0,lon=0)]
        self.assertEqual(features.vectors(row),first)

    def test_correspondence_preserves_left_right_and_branch_identity(self):
        a=[[math.pi,math.pi],[0,0],[math.pi/2,math.pi/2]]
        pairs,angle=features.matching(a,a[::-1]);self.assertEqual(angle,0)
        self.assertEqual(len(pairs),3)
        _,angle=features.matching(a,[[math.pi,math.pi],[0,0],[-math.pi/2,-math.pi/2]])
        self.assertGreater(angle,math.radians(45))
        row=sample();original=features.vectors(row)
        order=[2,0,1]
        for i,key in enumerate(('candidate','target')):
            row['signatures'][i]=[row['signatures'][i][j] for j in order]
            row['pair']['modelInput'][key]['branches']=[row['pair']['modelInput'][key]['branches'][j] for j in order]
        row['entryIndex']=row['targetEntryIndex']=1
        np.testing.assert_allclose(features.vectors(row)['C'],original['C'],atol=1e-10)

    def test_short_branch_reach_masks_and_early_curves_change_detailed_features(self):
        row=sample();first=features.vectors(row)
        for key in ('candidate','target'):
            frame=row['pair']['modelInput'][key];c=frame['center'];b=frame['branches'][0]
            frame['branches'][0]=[c,{k:c[k]+(b[-1][k]-c[k])*.1 for k in ('lat','lon')}]
        changed=features.vectors(row)
        self.assertEqual(first['B'],changed['B']);self.assertNotEqual(first['C'],changed['C'])
        row['entryIndex']=None;self.assertTrue(all(math.isfinite(x) for x in features.vectors(row)['C']))

    def test_tuning_ignores_outer_test_answers_and_export_reproduces_float32_predictions(self):
        rows=[dict(key=str(i),groups=[f'a{i}',f'b{i}'],centers=[dict(lat=35+i*.01,lon=135),dict(lat=35+i*.01,lon=135.001)],label='keep' if i%3==0 else 'omit',choice='indistinguishable' if i%3==0 else 'clear') for i in range(40)]
        X=np.asarray([[i%3,i%7] for i in range(40)],dtype=float)
        settings={**experiment.PARAMETERS,'n_estimators':5}
        with patch.object(experiment,'PARAMETERS',settings):
            before=experiment.tune(rows,X,list(range(30)),17)
            changed=copy.deepcopy(rows)
            for r in changed[30:]:r['label']='omit' if r['label']=='keep' else 'keep'
            after=experiment.tune(changed,X,list(range(30)),17)
            self.assertEqual(before,after)
            clf=experiment.classifier([r['label'] for r in rows[:30]]).fit(X[:30],[r['label'] for r in rows[:30]])
            model=json.loads(json.dumps(experiment.export(clf,'D',.3)))
            expected=clf.predict_proba(X[30:])[:,list(clf.classes_).index('keep')]
            np.testing.assert_allclose([experiment.predict_export(model,x) for x in X[30:]],expected,atol=1e-12)

    def test_unanswered_final_test_never_computes_predictions_and_rejects_a_changed_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);dataset=dict(id='final',pairs=[dict(id='one')],source={},responses=[])
            for name in ('answers','original'):(root/(name+'.json')).write_text(json.dumps(dataset))
            model=root/'model.json';model.write_text('{}');digest=hashlib.sha256(model.read_bytes()).hexdigest()
            (root/'source.json').write_text(json.dumps(dict(id='final',frozenModelSha256=digest,datasetSha256=hashlib.sha256((root/'original.json').read_bytes()).hexdigest())))
            (root/'freeze.json').write_text(json.dumps(dict(modelSha256=digest,plan=dict(featureCodeSha256=hashlib.sha256(Path(features.__file__).read_bytes()).hexdigest()))))
            args=[root/(name+'.json') for name in ('answers','model','freeze','original','source')]
            with patch.object(frozen,'predict_export',side_effect=AssertionError('Must remain unseen')):
                result=frozen.evaluate(*args);self.assertFalse(result['predictionsComputed'])
            model.write_text('{"changed":true}')
            with self.assertRaisesRegex(ValueError,'model differs'):frozen.evaluate(*args)


if __name__=='__main__':unittest.main()
