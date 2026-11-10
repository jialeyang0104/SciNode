"""Re-run one captured local task from an extracted SciNode package."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description='复现一个本地脚本任务；输出写入指定的空目录')
    parser.add_argument('task', help='README 中的任务 ID')
    parser.add_argument('--output', required=True, type=Path, help='指定空目录以保留已审阅成果')
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--rscript', default='Rscript')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    task = root / 'tasks' / args.task
    if task.resolve().parent != (root / 'tasks').resolve():
        raise ValueError('任务 ID 无效')
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    replacements = {}
    for item in manifest['files']:
        path = (root / item['name']).resolve()
        if not path.is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('成果包文件校验失败：' + item['name'])
        if item.get('originalPath'):
            for original in item.get('originalPaths', [item['originalPath']]):
                replacements[original] = str(path)
    def relocate(value):
        if isinstance(value, dict): return {key: relocate(child) for key, child in value.items()}
        if isinstance(value, list): return [relocate(child) for child in value]
        if isinstance(value, str): return replacements.get(value, value)
        return value
    execution_path = task / 'config/execution.json'
    if not execution_path.is_file():
        raise ValueError('此任务无本地可执行脚本；请在 SciNode 内重新运行模型、检索或人工确认步骤')
    execution = json.loads(execution_path.read_text(encoding='utf-8'))
    script = task / execution['script']
    if not script.resolve().is_relative_to(task.resolve()):
        raise ValueError('脚本路径无效')
    if args.output.resolve().is_relative_to(root):
        raise ValueError('复现输出请选择成果包目录之外的位置')
    args.output.mkdir(parents=True, exist_ok=True)
    if any(args.output.iterdir()):
        raise ValueError('输出目录必须为空')
    params = relocate(json.loads((task / 'config/input.json').read_text(encoding='utf-8')))
    with tempfile.TemporaryDirectory(prefix='scinode-reproduce-') as temporary:
        input_path = Path(temporary) / 'input.json'
        input_path.write_text(json.dumps(params, ensure_ascii=False), encoding='utf-8')
        env = {**os.environ, 'SCINODE_INPUT': str(input_path), 'SCINODE_OUTPUT': str(args.output.resolve())}
        for key in ['SCINODE_PREVIOUS_ROOT', 'SCINODE_CURRENT_ROOT']:
            env.pop(key, None)
        binary = args.rscript if execution['language'] == 'r' else args.python
        subprocess.run([binary, str(script)], cwd=task, env=env, check=True, timeout=execution['timeout'])
    print('复现结果：', args.output.resolve())


if __name__ == '__main__':
    main()
