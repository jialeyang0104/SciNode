import csv
import json
import tempfile
import unittest
from pathlib import Path

from postgres_workflow import catalog, csv_cell, extract, parse_plan, select_targets, validate_sql


class ReadOnlyTests(unittest.TestCase):
    def test_select_and_cte(self):
        validate_sql('WITH x AS (SELECT 1 AS a) SELECT * FROM x', set())
        validate_sql('SELECT count(*) FROM pg_catalog.pg_class', set())

    def test_reject_writes_locks_and_multiple_statements(self):
        for sql in ('SELECT 1; SELECT 2', 'DROP TABLE public.x',
                    'SELECT 1 INTO public.x', 'SELECT * FROM public.x FOR UPDATE',
                    'WITH x AS (DELETE FROM public.x RETURNING *) SELECT * FROM x'):
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                validate_sql(sql, {('public', 'x')})

    def test_reject_side_effect_functions_and_unknown_tables(self):
        for sql in ("SELECT pg_sleep(2)", "SELECT set_config('transaction_read_only','off',true)",
                    'SELECT public.count(*)', 'SELECT * FROM public.unknown', 'SELECT * FROM patients'):
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                validate_sql(sql, set())

    def test_literal_semicolon_is_not_a_second_statement(self):
        validate_sql("SELECT ';' AS value", set())

    def test_incomplete_plan(self):
        with self.assertRaisesRegex(ValueError, '结局'):
            parse_plan({'ready': False, 'missing': ['明确结局']})

    def test_targets_and_unknown_database(self):
        available = {5432: ['mimiciv'], 5433: ['mimiciii', 'eicu']}
        self.assertEqual(select_targets('数据库：5433/eicu', available), [(5433, 'eicu')])
        with self.assertRaises(ValueError):
            select_targets('数据库：5432/unknown', available)
        with self.assertRaises(ValueError):
            select_targets('数据库：5432/mimiciv；其他库', available)

    def test_csv_formula_and_missing_values(self):
        self.assertEqual(csv_cell('=1+1'), "'=1+1")
        self.assertEqual(csv_cell(-3), -3)
        self.assertEqual(csv_cell(None), '')

    def test_live_two_port_readonly_nulls_empty_results_and_truncation(self):
        sources = [{'port': port, 'database': database, 'tables': []}
                   for port, database in [(5432, 'mimiciv'), (5433, 'mimiciii')]]
        queries = [
            {'name': 'values_5432', 'port': 5432, 'database': 'mimiciv', 'max_rows': 2,
             'sql': "SELECT n, NULL::text AS missing, ''::text AS empty, %(term)s::text AS term, current_setting('transaction_read_only') AS read_only FROM pg_catalog.generate_series(1,3) AS n", 'params': {'term': "x'; SELECT 99; --"}},
            {'name': 'empty_5433', 'port': 5433, 'database': 'mimiciii', 'max_rows': 5,
             'sql': 'SELECT 1 AS value WHERE false', 'params': {}}]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            result = extract({'ready': True, 'queries': queries}, sources, output)
            first, second = result['preview']
            self.assertEqual(first['returned_rows'], 2)
            self.assertTrue(first['truncated'])
            self.assertEqual(first['rows'][0][1:3], [None, ''])
            self.assertEqual(first['rows'][0][-1], 'on')
            self.assertEqual(first['rows'][0][3], queries[0]['params']['term'])
            self.assertEqual(second['returned_rows'], 0)
            self.assertEqual(second['rows'], [])
            self.assertFalse(second['truncated'])
            records = [json.loads(line) for line in (output/'values_5432.jsonl').read_text().splitlines()]
            self.assertIsNone(records[0]['missing'])
            self.assertEqual(records[0]['empty'], '')
            with (output/'empty_5433.csv').open(encoding='utf-8-sig') as stream:
                self.assertEqual(list(csv.reader(stream)), [['value']])

    def test_live_catalog_contains_real_columns_without_patient_rows(self):
        result = catalog('数据库：5432/mimiciv；5433/mimiciii')
        self.assertEqual(len(result['sources']), 2)
        for source in result['sources']:
            self.assertGreater(len(source['tables']), 0)
            self.assertTrue(all(table['columns'] for table in source['tables']))
            self.assertTrue(all('rows' not in table for table in source['tables']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
