"""SciNode's local PostgreSQL metadata and read-only extraction nodes.

Authentication is delegated to libpq (environment / .pgpass). No credentials enter
the project, model prompts, or result files. Runs use the configured SciNode Python.
"""
import csv
import json
import math
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg2
from pglast.parser import parse_sql_json

PORTS = (5432, 5433)
DEFAULT_TARGETS = [(5432, 'mimiciv'), (5433, 'mimiciii')]
MAX_ROWS = 100000
PREVIEW_ROWS = 20
SAFE_FUNCTIONS = set('count sum avg min max round abs ceil ceiling floor trunc mod power sqrt '
    'stddev stddev_samp stddev_pop variance var_samp var_pop percentile_cont percentile_disc '
    'date_trunc date_part extract age to_char to_date to_timestamp make_date '
    'lower upper trim btrim ltrim rtrim length char_length substring substr replace '
    'regexp_replace regexp_match regexp_matches concat concat_ws left right split_part '
    'row_number rank dense_rank lag lead first_value last_value nth_value ntile '
    'bool_and bool_or array_agg string_agg json_agg jsonb_agg json_build_object '
    'jsonb_build_object json_object_agg jsonb_object_agg unnest generate_series '
    'current_database current_user current_schema current_setting inet_server_port '
    'now statement_timestamp transaction_timestamp pg_typeof obj_description col_description'.split())
SYSTEM_RELATIONS = {('pg_catalog', name) for name in (
    'pg_database', 'pg_namespace', 'pg_class', 'pg_attribute', 'pg_type', 'pg_description')}
SYSTEM_RELATIONS |= {('information_schema', name) for name in ('columns', 'tables', 'schemata')}


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def json_value(value):
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if isinstance(value, bytes):
        return {'encoding': 'hex', 'value': value.hex()}
    raise TypeError('此字段类型需要明确导出方式：' + type(value).__name__)


def normalize(value):
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    return value


def dump(value):
    return json.dumps(normalize(value), default=json_value, ensure_ascii=False, allow_nan=False)


def connect(port, database):
    if port not in PORTS:
        raise ValueError('仅支持本机 PostgreSQL 5432、5433。')
    prefix = 'PG' + str(port) + '_'
    options = dict(host=os.environ.get(prefix + 'HOST', '127.0.0.1'), port=port,
                   dbname=database, user=os.environ.get(prefix + 'USER', 'postgres'),
                   connect_timeout=8, application_name='SciNode-readonly',
                   options='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000 -c search_path=pg_catalog')
    if os.environ.get(prefix + 'PASSWORD'):
        options['password'] = os.environ[prefix + 'PASSWORD']
    if os.environ.get(prefix + 'SSLMODE'):
        options['sslmode'] = os.environ[prefix + 'SSLMODE']
    conn = psycopg2.connect(**options)
    conn.set_session(readonly=True)
    return conn


def database_inventory():
    available = {}
    for port in PORTS:
        conn = connect(port, 'postgres')
        try:
            with conn.cursor() as cursor:
                cursor.execute('SELECT datname FROM pg_catalog.pg_database '
                               'WHERE datallowconn AND NOT datistemplate ORDER BY datname')
                available[port] = [row[0] for row in cursor.fetchall()]
        finally:
            conn.rollback()
            conn.close()
    return available


def select_targets(request, available):
    line = re.search(r'(?m)^\s*(?:目标)?数据库\s*[:：]\s*(.+)$', request)
    if line:
        targets = [(int(port), name) for port, name in re.findall(r'\b(5432|5433)\s*/\s*([A-Za-z][A-Za-z0-9_]*)\b', line[1])]
        if not targets:
            raise ValueError('数据库一行请填写“5432/mimiciv；5433/mimiciii”，或删去此行使用这两个默认库。')
        remainder = re.sub(r'\b(5432|5433)\s*/\s*[A-Za-z][A-Za-z0-9_]*\b', '', line[1])
        if remainder.strip(' ;；,，、和与及\t'):
            raise ValueError('数据库一行存在未识别的内容，请使用“端口/库名”格式。')
    else:
        targets = list(DEFAULT_TARGETS)
    targets = list(dict.fromkeys(targets))
    for port, name in targets:
        if name not in available.get(port, []):
            raise ValueError(f'{port} 端口没有数据库 {name}。可选：' + '、'.join(available.get(port, [])))
    return targets


def catalog(request):
    available = database_inventory()
    targets = select_targets(request, available)
    sources = []
    for port, database in targets:
        conn = connect(port, database)
        try:
            with conn.cursor() as cursor:
                cursor.execute("""SELECT n.nspname,c.relname,a.attname,
                    pg_catalog.format_type(a.atttypid,a.atttypmod)
                    FROM pg_catalog.pg_namespace n
                    JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
                    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
                    WHERE c.relkind IN ('r','v','m','p','f') AND a.attnum>0 AND NOT a.attisdropped
                    AND n.nspname NOT LIKE 'pg_%%' AND n.nspname<>'information_schema'
                    ORDER BY n.nspname,c.relname,a.attnum""")
                tables = {}
                for schema, table, column, datatype in cursor:
                    tables.setdefault((schema, table), []).append([column, datatype])
            sources.append({'port': port, 'database': database,
                'tables': [{'schema': key[0], 'table': key[1], 'columns': columns}
                           for key, columns in tables.items()]})
        finally:
            conn.rollback()
            conn.close()
    summary = '；'.join(f"{item['port']}/{item['database']}：{len(item['tables'])} 张表或视图" for item in sources)
    return {'text': summary, 'catalog_json': dump({'available_databases': available, 'sources': sources}),
            'sources': sources, 'available_databases': available,
            'summary': summary,
            'captured_at': timestamp()}


def parse_plan(value):
    if isinstance(value, str):
        value = re.sub(r'^\s*```(?:json)?\s*\n?|\n?```\s*$', '', value.strip())
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise ValueError('查询方案不是有效 JSON，请让助手重新生成完整方案。') from None
    if not isinstance(value, dict) or value.get('ready') is not True:
        missing = value.get('missing', []) if isinstance(value, dict) else []
        raise ValueError('需求尚待补充：' + '；'.join(map(str, missing or ['请核对查询方案。'])))
    if not isinstance(value.get('queries'), list) or not 1 <= len(value['queries']) <= 4:
        raise ValueError('每轮支持 1–4 条查询。')
    return value


def validate_sql(sql, allowed_relations):
    tree = json.loads(parse_sql_json(sql))
    if len(tree['stmts']) != 1 or 'SelectStmt' not in tree['stmts'][0]['stmt']:
        raise ValueError('只执行一条 SELECT 查询。')
    ctes = set()

    def walk(item, collect=False):
        if isinstance(item, list):
            for child in item:
                walk(child, collect)
        elif isinstance(item, dict):
            if 'CommonTableExpr' in item:
                ctes.add(item['CommonTableExpr']['ctename'])
            if not collect:
                for key, value in item.items():
                    if key.endswith('Stmt') and key != 'SelectStmt':
                        raise ValueError('查询中含有非只读语句：' + key)
                    if key == 'SelectStmt' and (value.get('intoClause') or value.get('lockingClause')):
                        raise ValueError('不能使用 SELECT INTO 或行锁。')
                    if key == 'FuncCall':
                        names = [part['String']['sval'] for part in value['funcname']]
                        if names[-1] not in SAFE_FUNCTIONS or len(names)>2 or (len(names)==2 and names[0]!='pg_catalog'):
                            raise ValueError('此函数需要人工确认后加入允许列表：' + '.'.join(names))
                    if key == 'RangeVar':
                        schema, table = value.get('schemaname'), value['relname']
                        if not schema and table in ctes:
                            continue
                        if not schema or (schema, table) not in allowed_relations | SYSTEM_RELATIONS:
                            raise ValueError('请使用本次目标库中的完整 schema.表名：' + (schema+'.' if schema else '') + table)
            for child in item.values():
                walk(child, collect)
    walk(tree, True)
    walk(tree)


def csv_cell(value):
    if value is None:
        return ''
    if isinstance(value, (dict, list, tuple)):
        value = dump(value)
    elif not isinstance(value, (str, int, float, bool)):
        value = json_value(value)
    if isinstance(value, str) and (value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n'))):
        return "'" + value
    return value


def extract(plan_value, sources, output):
    plan = parse_plan(plan_value)
    output.mkdir(parents=True, exist_ok=True)
    previews, execution = [], []
    used_names = set()
    source_map = {(item['port'], item['database']): item for item in sources}
    for query in plan['queries']:
        name, port, database = query.get('name'), query.get('port'), query.get('database')
        cap, params = query.get('max_rows', 5000), query.get('params', {})
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,59}', name) or name in used_names:
            raise ValueError('查询名称须为不同的英文、数字和下划线组合。')
        used_names.add(name)
        if (port, database) not in source_map:
            raise ValueError(f'查询目标 {port}/{database} 不在本轮读取的数据库中。')
        if type(cap) is not int or not 1 <= cap <= MAX_ROWS or not isinstance(params, dict):
            raise ValueError('每条查询需设置 1–100000 行上限，筛选参数使用对象。')
        sql = query.get('sql', '')
        if not isinstance(sql, str) or not sql.strip():
            raise ValueError('查询 SQL 不能为空。')
        conn = connect(port, database)
        try:
            with conn.cursor() as check:
                rendered = check.mogrify(sql, params).decode(conn.encoding)
                allowed = {(table['schema'], table['table']) for table in source_map[(port, database)]['tables']}
                validate_sql(rendered, allowed)
                check.execute('SHOW transaction_read_only')
                if check.fetchone()[0] != 'on':
                    raise ValueError('数据库未进入只读事务，已停止查询。')
            with conn.cursor(name='scinode_extract') as cursor:
                cursor.itersize = 1000
                cursor.execute(sql, params)
                rows = cursor.fetchmany(1)
                columns = [column.name for column in cursor.description]
                if len(set(columns)) != len(columns):
                    raise ValueError('输出字段名称重复，请在 SQL 中为重复字段设置别名。')
                preview, count, truncated = [], 0, False
                with (output/(name+'.csv')).open('w', encoding='utf-8-sig', newline='') as csvfile, (output/(name+'.jsonl')).open('w', encoding='utf-8') as jsonfile:
                    writer = csv.writer(csvfile)
                    writer.writerow(columns)
                    while rows:
                        for row in rows:
                            if count >= cap:
                                truncated = True
                                break
                            normalized = json.loads(dump(list(row)))
                            writer.writerow([csv_cell(value) for value in normalized])
                            jsonfile.write(dump(dict(zip(columns, normalized)))+'\n')
                            if count < PREVIEW_ROWS:
                                preview.append(normalized)
                            count += 1
                        if truncated:
                            break
                        rows = cursor.fetchmany(min(1000, cap-count+1))
                item = {'name': name, 'port': port, 'database': database, 'status': 'success',
                        'columns': columns, 'rows': preview, 'returned_rows': count,
                        'preview_rows': len(preview), 'truncated': truncated, 'max_rows': cap,
                        'sql': sql, 'params': params, 'transaction_read_only': True, 'finished_at': timestamp()}
                previews.append(item)
                execution.append({key: value for key, value in item.items() if key not in ('rows',)})
        finally:
            conn.rollback()
            conn.close()
    total = sum(item['returned_rows'] for item in previews)
    text = f'已完成 {len(previews)} 条只读查询，共导出 {total} 行。每条预览前 {PREVIEW_ROWS} 行；完整结果见 CSV / JSONL。'
    if any(item['truncated'] for item in previews):
        text += '部分结果达到行数上限，请查看截取标记并按需分批提取。'
    (output/'preview.json').write_text(dump(previews), encoding='utf-8')
    (output/'queries.sql').write_text('\n\n'.join('-- '+item['name']+' | '+str(item['port'])+'/'+item['database']+'\n'+item['sql'].rstrip(';')+';' for item in execution), encoding='utf-8')
    manifest = {'queries': execution, 'requirements': plan.get('requirements', ''),
        'preview_limit': PREVIEW_ROWS, 'csv_null_encoding': 'empty cell',
        'jsonl_null_encoding': 'null; empty strings remain empty strings',
        'csv_formula_protection': True, 'decimal_encoding': 'string to retain precision',
        'snapshot_scope': 'Each query uses a separate read-only transaction; no cross-database shared snapshot.'}
    (output/'manifest.json').write_text(dump(manifest), encoding='utf-8')
    (output/'summary.md').write_text('# 数据提取结果\n\n'+text+'\n\n'+
        '\n'.join(f"- {item['port']}/{item['database']} · {item['name']}：{item['returned_rows']} 行"+
            ('（达到上限）' if item['truncated'] else '') for item in previews)+
        '\n\nCSV 便于 Excel 打开；JSONL 保留空值与空字符串区别。各库分别交付。', encoding='utf-8')
    return {'text': text, 'preview': previews, 'execution': execution,
            'files': [path.name for path in output.iterdir() if path.is_file()], 'manifest': manifest}


def run_node(operation):
    src = json.loads(Path(os.environ['SCINODE_INPUT']).read_text(encoding='utf-8'))
    output = Path(os.environ['SCINODE_OUTPUT'])
    output.mkdir(parents=True, exist_ok=True)
    try:
        result = catalog(src['request']) if operation == 'catalog' else extract(src['plan'], src['sources'], output)
    except psycopg2.Error as error:
        code = error.pgcode or 'connection'
        message = {'08001': '连接失败', '08006': '连接中断', '28P01': '认证失败',
                   '42501': '查询权限不足', '57014': '查询超过60秒', '42P01': '表不存在',
                   '42703': '字段不存在'}.get(code, '数据库查询失败')
        raise RuntimeError(f'{message}（{code}）。检查目标库、字段与连接配置；此前已生成的文件保留。') from None
    (output/'result.json').write_text(dump(result), encoding='utf-8')
    print(result.get('summary') or result.get('text', '')[:240])
