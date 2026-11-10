"""Leakage, labels and exported-model tests for the local training pipeline."""
import copy
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_ai', ROOT/'scripts/local_ai.py')
ai = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai)


def frame(lon=135):
    center = dict(lat=35, lon=lon)
    return dict(center=center, heading=0, branches=[[center, dict(lat=35+math.cos(a)*.0002, lon=lon+math.sin(a)*.0002)] for a in (0, math.pi, math.pi/2)])


def dataset(identifier='one'):
    a, b = frame(), frame(135.01)
    b.update(routeIn=[b['center']], routeOut=[b['center']])
    return dict(format='kyoto-junction-evaluation', version=2, id=identifier, createdAt='2026-11-10T00:00:00Z',
        source=dict(courseName='test', sourceDate=None, ruleVersion='test-rule', generationVersion=9, ruleThresholdDegrees=20, evaluationMode='diagram', sampling='all-omittable-before-next-mandatory-frame'),
        pairs=[dict(id='pair', modelInput=dict(candidate=a,target=b), splitGroups=['osm-node:1','osm-node:2'], rulePrediction='keep', context=dict(candidateId='a', targetId='b', candidateAt=1, targetAt=10))],
        responses=[dict(pairId='pair', evaluatorId='P001', role='participant', choice='borderline', notes='', activeViewMs=1000, decisionMs=500, updatedAt='2026-11-10T01:00:00Z', revision=1)])


def row(i, label='omit'):
    return dict(key=str(i).zfill(3), label=label, choice='clear' if label=='omit' else 'indistinguishable',
                rule='omit', groups=[f'a{i}',f'b{i}'], centers=[dict(lat=35,lon=135+i*.01),dict(lat=35,lon=135.001+i*.01)],
                signatures=[[[0,0],[math.pi, math.pi],[math.pi/2,math.pi/2]]]*2)


class LocalAITest(unittest.TestCase):
    def prepare(self, *datasets):
        with tempfile.TemporaryDirectory() as directory:
            paths=[]
            for i,d in enumerate(datasets):
                p=Path(directory)/f'{i}.json'; p.write_text(json.dumps(d)); paths.append(p)
            return ai.load_exports(paths, 'P001')

    def test_multiple_exports_deduplicate_and_do_not_trust_imported_labels(self):
        first=dataset(); first['responses'][0]['trainingLabel']='keep'
        second=dataset('two')
        prepared=self.prepare(first,second)
        self.assertEqual(len(prepared['rows']),1)
        self.assertEqual(prepared['rows'][0]['label'],'omit')
        self.assertEqual(prepared['excluded']['duplicates'],1)
        self.assertEqual(len(prepared['datasetIds']),2)

    def test_conflicting_answers_fail(self):
        other=dataset('two'); other['responses'][0]['choice']='indistinguishable'
        with self.assertRaisesRegex(ValueError,'競合'):
            self.prepare(dataset(),other)

    def test_rule_versions_must_match(self):
        other=dataset('two'); other['source']['ruleVersion']='different'
        with self.assertRaisesRegex(ValueError,'基準ルール'):
            self.prepare(dataset(),other)

    def test_uncertain_unblinded_and_other_evaluators_excluded(self):
        d=dataset();d['responses'][0]['choice']='uncertain'
        self.assertEqual(self.prepare(d)['excluded']['uncertain'],1)
        d=dataset();d['responses'][0]['ruleViewedAt']='2026-11-10T00:59:00Z'
        self.assertEqual(self.prepare(d)['excluded']['unblinded'],1)
        d=dataset();d['responses'][0]['blindAtDecision']=False
        self.assertEqual(self.prepare(d)['excluded']['unblinded'],1)
        d=dataset();d['responses'][0]['evaluatorId']='P002'
        self.assertEqual(self.prepare(d)['excluded']['unanswered'],1)

    def test_physical_id_and_nearby_nodes_form_transitive_components(self):
        rows=[row(i) for i in range(4)]
        rows[1]['groups'][0]=rows[0]['groups'][1]
        rows[2]['centers'][0]=dict(rows[1]['centers'][1])
        self.assertEqual(sorted(map(len,ai.components(rows))),[1,3])
        self.assertEqual(sorted(map(len,ai.components(rows,0))),[1,3])

    def test_split_is_deterministic_disjoint_and_independent_of_rule_predictions(self):
        rows=[row(i, 'keep' if i%2 else 'omit') for i in range(40)]
        rows[1]['groups'][0]=rows[0]['groups'][0]
        train,val,n=ai.split_rows(rows)
        self.assertEqual((train,val,n),ai.split_rows(rows))
        self.assertFalse({g for i in train for g in rows[i]['groups']} & {g for i in val for g in rows[i]['groups']})
        changed=copy.deepcopy(rows)
        for r in changed:r['rule']='keep'
        self.assertEqual((train,val,n),ai.split_rows(changed))

    def test_single_connected_group_and_single_class_fail(self):
        rows=[row(i) for i in range(10)]
        with self.assertRaisesRegex(ValueError,'両ラベル'):
            ai.split_rows(rows)
        for r in rows:r['groups'][0]='shared'
        with self.assertRaisesRegex(ValueError,'連結'):
            ai.split_rows(rows)

    def test_features_preserve_left_right_and_ignore_row_metadata(self):
        r=row(0); a=ai.features(r['signatures'])
        mirrored=[[[-x for x in branch] for branch in signature] for signature in r['signatures']]
        self.assertNotEqual(a,ai.features(mirrored))
        r.update(rule='keep',label='keep',key='secret',centers=[])
        self.assertEqual(a,ai.features(r['signatures']))
        self.assertEqual(len(a),147)

    def test_metrics_keep_borderline_omit_and_count_false_omissions(self):
        a=row(0,'keep');b=row(1);b['choice']='borderline'
        result=ai.metrics([a,b],['omit','keep'])
        self.assertEqual(result['falseOmissionRate'],1)
        self.assertEqual(result['unnecessaryKeepRate'],1)
        self.assertEqual(result['borderlineOmissionRate'],0)
        self.assertIsNone(ai.metrics([],[])['accuracy'])

    def test_exported_json_forest_matches_sklearn(self):
        from sklearn.ensemble import RandomForestClassifier
        x=[[i/10,math.sin(i)] for i in range(30)]
        y=['keep' if i%3==0 else 'omit' for i in range(30)]
        model=RandomForestClassifier(n_estimators=15,max_depth=3,random_state=42).fit(x,y)
        exported=json.loads(json.dumps(ai.export_model(model,.5)))
        for vector, expected in zip(x,model.predict_proba(x)):
            self.assertAlmostEqual(ai.predict_probability(exported,vector),expected[list(model.classes_).index('keep')])


if __name__ == '__main__':
    unittest.main()
