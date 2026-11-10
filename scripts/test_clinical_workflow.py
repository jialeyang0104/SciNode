"""Offline clinical execution and portable-package acceptance checks.
Run with the configured SCINODE_PYTHON interpreter.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

import numpy as np
import pandas as pd

RESOURCES = Path(__file__).resolve().parents[1] / 'backend/src/main/resources/scinode'
sys.path.insert(0, str(RESOURCES))
from tabular_data import inspect_table, read_table
from clinical_analysis import analyze
from task_package import build_package


class ClinicalWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='scinode-clinical-test-')
        self.root = Path(self.temporary.name)
        self.out = self.root / 'output'; self.out.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def run_analysis(self, frame, preset, config):
        path = self.root / 'clinical.csv'; frame.to_csv(path, index=False)
        return analyze({'filePath': str(path), 'analysisPreset': preset, 'analysis': config}, self.out)

    def test_csv_xlsx_preview_and_model_text_boundary(self):
        data = pd.DataFrame({'patient_id': ['PRIVATE-A', 'PRIVATE-B'], 'age': [45, None], 'event': [0, 1]})
        for suffix in ['csv', 'xlsx']:
            path = self.root / ('patients.' + suffix)
            data.to_csv(path, index=False) if suffix == 'csv' else data.to_excel(path, index=False)
            result = inspect_table(path)
            self.assertEqual(2, result['n'])
            self.assertEqual(1, result['columns'][1]['missing'])
            self.assertIn('PRIVATE-A', json.dumps(result['preview']))
            self.assertNotIn('PRIVATE-A', result['text'])
            self.assertNotIn('PRIVATE-B', result['text'])
        workbook = self.root / 'sheets.xlsx'
        with pd.ExcelWriter(workbook) as writer:
            pd.DataFrame({'value': [99]}).to_excel(writer, sheet_name='first', index=False)
            data.to_excel(writer, sheet_name='cohort', index=False)
        result = inspect_table(workbook, 'cohort')
        self.assertEqual('cohort', result['sheet'])
        self.assertEqual(2, result['n'])
        analyzed = analyze({'dataPath': str(workbook), 'sheet': 'cohort', 'analysisPreset': 'quality'}, self.out)
        self.assertEqual(2, analyzed['n'])
        path = self.root / 'duplicate.csv'; path.write_text('age,age\n1,2\n')
        with self.assertRaisesRegex(ValueError, '重复列名'):
            read_table(path)

    def test_quality_and_baseline_denominators(self):
        frame = pd.DataFrame({'id': [1, 1, 2, 3, 4], 'group': ['A', 'A', 'B', 'B', None],
                              'age': [20, 40, 40, 60, None], 'sex': ['F', None, 'F', 'M', 'F']})
        result = self.run_analysis(frame, 'quality', {'idColumn': 'id'})
        self.assertEqual(2, result['summary']['duplicate_ID_rows'])
        self.assertEqual(1, pd.read_csv(self.out / 'data-quality.csv').set_index('variable').loc['age', 'missing_n'])
        result = self.run_analysis(frame, 'table1', {'group': 'group', 'continuous': ['age'], 'categorical': ['sex'], 'continuousFormat': 'mean'})
        self.assertEqual(1, result['summary']['group_missing'])
        table = pd.read_csv(self.out / 'table1.csv')
        self.assertAlmostEqual(2**.5, table.loc[0, 'absolute_SMD'], places=4)
        self.assertIn('1 (100.0%)', table.loc[1, 'A (n=2)'])
        self.assertIn('缺失 1', table.loc[1, 'A (n=2)'])

    def test_logistic_matches_two_by_two_odds_ratio(self):
        # Group 0: 10 events / 30 non-events; group 1: 40 events / 20 non-events.
        frame = pd.DataFrame({'exposure': [0]*40+[1]*60, 'event': [1]*10+[0]*30+[1]*40+[0]*20})
        result = self.run_analysis(frame, 'regression', {'outcome': 'event', 'covariates': ['exposure'], 'method': 'logistic'})
        estimates = pd.read_csv(self.out / 'regression.csv')
        self.assertAlmostEqual(6., estimates.loc[0, 'OR'], places=6)
        expected_se = (1/40 + 1/20 + 1/10 + 1/30)**.5
        self.assertAlmostEqual(np.exp(np.log(6)-1.959963984540054*expected_se), estimates.loc[0, 'lower95'], places=6)
        self.assertEqual(100, result['summary']['analyzed'])
        self.assertTrue((self.out / 'forest.png').stat().st_size > 1000)
        self.assertTrue((self.out / 'forest.pdf').stat().st_size > 1000)

    def test_km_and_cox_use_real_censoring(self):
        rng = np.random.default_rng(31)
        n = 240; exposure = rng.integers(0, 2, n); age = rng.normal(60, 10, n)
        time = rng.exponential(np.exp(-.5*exposure)*20)
        censored = time > 18
        frame = pd.DataFrame({'age': age, 'group': exposure, 'time': np.minimum(time, 18), 'event': (~censored).astype(int)})
        result = self.run_analysis(frame, 'km', {'group': 'group', 'time': 'time', 'outcome': 'event'})
        self.assertEqual(n, result['summary']['analyzed'])
        self.assertTrue(0 <= result['summary']['logrank_P'] <= 1)
        table = pd.read_csv(self.out / 'survival.csv')
        self.assertEqual(int((~censored).sum()), int(table.events.sum()))
        result = self.run_analysis(frame, 'regression', {'outcome': 'event', 'time': 'time', 'covariates': ['group', 'age'], 'method': 'cox'})
        self.assertEqual(int((~censored).sum()), result['summary']['events'])
        self.assertTrue((self.out / 'proportional-hazards.csv').is_file())
        self.assertTrue((pd.read_csv(self.out / 'regression.csv').HR > 0).all())

    def test_prediction_reproducible_split_and_train_only_imputation(self):
        import joblib
        from sklearn.model_selection import train_test_split
        rng = np.random.default_rng(2026)
        n = 240; x = rng.normal(size=n); y = rng.binomial(1, 1/(1+np.exp(-x)))
        x[::7] = np.nan
        frame = pd.DataFrame({'id': range(n), 'x': x, 'event': y})
        config = {'outcome': 'event', 'covariates': ['x'], 'idColumn': 'id', 'testFraction': .25, 'seed': 2026}
        first = self.run_analysis(frame, 'prediction', config)
        model = joblib.load(self.out / 'prediction-model.joblib')
        training, _ = train_test_split(frame, test_size=.25, random_state=2026, stratify=y)
        imputer = model[0].named_transformers_['numeric'][0]
        self.assertAlmostEqual(float(training.x.median()), float(imputer.statistics_[0]))
        self.assertEqual(180, first['summary']['training_n'])
        self.assertEqual(60, first['summary']['validation_n'])
        self.assertEqual(first['summary'], self.run_analysis(frame, 'prediction', config)['summary'])
        frame.loc[1, 'id'] = frame.loc[0, 'id']
        with self.assertRaisesRegex(ValueError, '完整唯一'):
            self.run_analysis(frame, 'prediction', config)

    def test_invalid_event_and_non_numeric_fail_explicitly(self):
        frame = pd.DataFrame({'x': range(60), 'event': [0, 1, 2]*20})
        with self.assertRaisesRegex(ValueError, '两个取值'):
            self.run_analysis(frame, 'regression', {'outcome': 'event', 'covariates': ['x']})
        frame['event'] = [0, 1]*30; frame['x'] = 'unparsed'
        with self.assertRaisesRegex(ValueError, '非数字'):
            self.run_analysis(frame, 'regression', {'outcome': 'event', 'covariates': ['x']})

    def test_structured_package_relocates_input_and_verifies_hashes(self):
        data = self.root / 'patients.csv'; data.write_text('value\n2\n5\n')
        task = self.root / 'original/tasks/analyze'
        (task / 'src').mkdir(parents=True); (task / 'config').mkdir()
        (task / 'src/script.py').write_text("import os,json,csv\nfrom pathlib import Path\np=json.loads(Path(os.environ['SCINODE_INPUT']).read_text())\nwith open(p['filePath']) as f: values=[int(r['value']) for r in csv.DictReader(f)]\n(Path(os.environ['SCINODE_OUTPUT'])/'sum.txt').write_text(str(sum(values)))\n")
        (task / 'config/execution.json').write_text(json.dumps({'language': 'python', 'script': 'src/script.py', 'timeout': 10}))
        (task / 'config/input.json').write_text(json.dumps({'filePath': str(data)}))
        (task / 'README.md').write_text('# Analysis')
        artifacts = [{'nodeId': 'analyze', 'name': p.name, 'path': str(p), 'relativePath': 'tasks/analyze/'+str(p.relative_to(task)),
                      'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in task.rglob('*') if p.is_file()]
        params = {'artifacts': artifacts, 'definition': {'name': 'Fixture', 'nodes': [{'id': 'analyze', 'data': {'label': 'Analysis'}}],
                     'files': [{'id': 'data', 'name': 'patients.csv', 'path': str(data), 'sha256': hashlib.sha256(data.read_bytes()).hexdigest()}]}}
        result = build_package(params, self.out)
        package = self.root / 'moved'; package.mkdir()
        with zipfile.ZipFile(self.out / result['fileName']) as archive:
            archive.extractall(package)
        data.unlink()  # No access to the recorded absolute source path.
        completed = subprocess.run([sys.executable, str(package/'reproduce.py'), 'analyze', '--output', str(self.root/'reproduced')], capture_output=True, text=True)
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual('7', (self.root/'reproduced/sum.txt').read_text())
        (package/'inputs/data_patients.csv').write_text('tampered')
        completed = subprocess.run([sys.executable, str(package/'reproduce.py'), 'analyze', '--output', str(self.root/'tamper-test')], capture_output=True, text=True)
        self.assertNotEqual(0, completed.returncode)
        self.assertIn('校验失败', completed.stderr)

    def test_package_index_identifies_its_producer_without_completing_future_tasks(self):
        out = self.root / 'tasks/package/output'
        out.mkdir(parents=True)
        params = {'definition': {'nodes': [
            {'id': 'package', 'data': {'kind': 'package', 'label': '成果整理'}},
            {'id': 'later', 'data': {'kind': 'package', 'label': '后续成果整理'}},
        ]}}
        build_package(params, out)
        with zipfile.ZipFile(out / 'research-package.zip') as archive:
            readme = archive.read('README.md').decode()
        self.assertIn('| package | 成果整理 | SUCCESS | 本成果包由此节点生成 |', readme)
        self.assertIn('| later | 后续成果整理 | 未执行 |', readme)


if __name__ == '__main__':
    unittest.main()
