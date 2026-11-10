"""Local clinical tables: strict headers, explicit missing values and bounded previews."""
import csv
import hashlib
import json
from pathlib import Path

MAX_ROWS = 200_000
MAX_COLUMNS = 500


def read_table(path, sheet=None):
    import pandas as pd
    path = Path(path)
    if path.suffix.lower() == '.csv':
        encoding = 'utf-8-sig'
        try:
            with path.open(encoding=encoding) as stream:
                stream.read()
        except UnicodeDecodeError:
            encoding = 'gb18030'
        with path.open(encoding=encoding, newline='') as stream:
            reader = csv.reader(stream)
            headers = next(reader, [])
            for number, row in enumerate(reader, start=2):
                if row and len(row) != len(headers):
                    raise ValueError(f'CSV 第 {number} 行字段数与表头不一致')
                if number > MAX_ROWS + 1:
                    raise ValueError(f'单表上限为 {MAX_ROWS} 行，请拆分后导入')
        frame = pd.read_csv(path, encoding=encoding, nrows=MAX_ROWS + 1)
    elif path.suffix.lower() == '.xlsx':
        from openpyxl import load_workbook
        book = load_workbook(path, read_only=True, data_only=True)
        try:
            tab = book[sheet] if sheet else book.worksheets[0]
            iterator = tab.iter_rows(values_only=True)
            headers = list(next(iterator, []))
            rows = []
            for row in iterator:
                rows.append(row)
                if len(rows) > MAX_ROWS:
                    break
            frame = pd.DataFrame(rows, columns=headers)
        finally:
            book.close()
    else:
        raise ValueError('临床数据表请使用 CSV 或 XLSX')
    if not headers or any(value is None or not str(value).strip() for value in headers):
        raise ValueError('首行必须是完整列名，请补齐空白表头')
    names = [str(value) for value in headers]
    if len(set(names)) != len(names):
        raise ValueError('表头含重复列名，请使用唯一列名')
    if len(names) > MAX_COLUMNS or len(frame) > MAX_ROWS:
        raise ValueError(f'单表上限为 {MAX_ROWS} 行、{MAX_COLUMNS} 列，请拆分后导入')
    if frame.empty:
        raise ValueError('数据表没有可分析的记录')
    frame.columns = names
    return frame


def inspect_table(path, sheet=None):
    frame = read_table(path, sheet)
    columns = []
    for name in frame:
        values = frame[name]
        examples = json.loads(values.dropna().head(3).to_json(orient='values', date_format='iso'))
        columns.append({'name': name, 'type': str(values.dtype), 'nonNull': int(values.notna().sum()),
                        'missing': int(values.isna().sum()), 'examples': examples})
    rows = json.loads(frame.head(20).to_json(orient='values', date_format='iso'))
    # Model text deliberately contains no example values or patient rows.
    text = '# 数据字典与缺失概况\n\n记录数：' + str(len(frame)) + '\n\n| 列名 | 类型 | 非空数 | 缺失数 |\n|---|---|---:|---:|\n'
    for column in columns:
        name = column['name'].replace('|', '\\|').replace('\n', ' ')
        text += f"| {name} | {column['type']} | {column['nonNull']} | {column['missing']} |\n"
    return {'n': len(frame), 'sheet': sheet or '', 'sourceSha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(), 'columns': columns, 'dataPath': str(Path(path).resolve()), 'text': text,
            'summary': {'rows': len(frame), 'columns': len(columns)},
            'preview': [{'name': '数据表', 'database': Path(path).name, 'port': 0, 'sourceType': 'file',
                         'columns': list(frame.columns), 'rows': rows, 'returned_rows': len(frame),
                         'truncated': False, 'status': 'SUCCESS'}]}
