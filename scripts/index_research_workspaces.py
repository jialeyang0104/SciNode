"""Refresh human-readable navigation without moving inputs, frozen files or run records."""
import argparse
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import quote


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.readme-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(text)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def refresh(data_root, previous=None, current=None):
    def relocated(value):
        path = Path(value)
        if previous and current and path.is_relative_to(previous):
            path = current / path.relative_to(previous)
        return path
    def link(path, base):
        return quote(os.path.relpath(path, base), safe='/._-')
    counts = {'projects': 0, 'runs': 0, 'tasks': 0, 'missing_workspaces': 0}
    for owner in data_root.iterdir():
        if not owner.is_dir():
            continue
        histories = [json.loads(file.read_text()) for file in (owner/'runs').glob('*.json')]
        for record in (owner/'projects').glob('*.json'):
            project = json.loads(record.read_text())
            workspace = relocated(project['workspace'])
            if not workspace.is_dir():
                counts['missing_workspaces'] += 1
                continue
            runs = sorted([run for run in histories if run['projectId'] == project['id']], key=lambda run: run.get('createdAt', ''), reverse=True)
            text = '# ' + project['name'] + '\n\n此目录保存本项目原始资料和逐次运行。编辑任务请进入 SciNode 工作台。\n\n'
            if runs and relocated(runs[0]['runDir']).is_dir():
                text += f"现在先看：[最近一次运行]({link(relocated(runs[0]['runDir'])/'README.md', workspace)}) · {runs[0]['status']}。\n\n"
            text += '| 路径 | 用途 | 入口 |\n|---|---|---|\n| inputs/ | 导入原件，保持原样 | 应用内项目资料 |\n| runs/ | 每次运行的代码、配置、日志与成果 | 各运行 README |\n\n'
            text += '历史记录、人工决策与冻结成果保持原位；复用任务通过链接指向实际来源。新运行按 tasks/任务ID 分开保存。\n\n'
            text += '| 运行 | 配置版本 | 状态 | 入口 |\n|---|---|---|---|\n'
            for run in runs:
                root = relocated(run['runDir'])
                if not root.is_dir():
                    continue
                text += f"| {run['id']} | {run['revision']} | {run['status']}{' · 已冻结' if run.get('frozen') else ''} | [查看]({link(root/'README.md', workspace)}) |\n"
                summary = f"# {run['projectName']} · 运行 {run['id']}\n\n状态：{run['status']}；配置版本：{run['revision']}。\n\n"
                summary += '| 任务 | 类型 | 状态 | 先看什么 |\n|---|---|---|---|\n'
                for node in run['definition']['nodes']:
                    nid = node['id']; result = run.get('nodeResults', {}).get(nid, {})
                    task = root / ('tasks' if run.get('taskLayout') == 2 else '') / nid
                    label = node['data'].get('label', nid).replace('|', '\\|')
                    if result.get('reusedFrom'):
                        parent = next((candidate for candidate in histories if candidate['id'] == result['reusedFrom']), None)
                        location = f"复用 [来源运行]({link(relocated(parent['runDir'])/'README.md', root)})" if parent else '来源运行记录缺失'
                    elif task.is_dir():
                        location = f'[任务文件]({link(task / "README.md", root)})'
                        if run.get('taskLayout') != 2 and not (task/'README.md').exists():
                            body = '# ' + node['data'].get('label', nid) + '\n\n历史任务采用原目录，文件含义如下。\n\n| 文件 | 用途 |\n|---|---|\n'
                            descriptions = {'script.py': '实际执行 Python 代码', 'script.R': '实际执行 R 代码', 'input.json': '实际输入与参数',
                                            'stdout.log': '标准输出日志', 'stderr.log': '错误日志', 'output': '生成报告、表格和图表'}
                            for entry in sorted(task.iterdir()):
                                if entry.name.startswith('.') or entry.name == '__pycache__': continue
                                body += f"| [{entry.name}]({quote(entry.name)}) | {descriptions.get(entry.name, '任务产物')} |\n"
                            body += '\n历史包可能未收录代码；以本目录实际文件与应用内运行定义为准。新任务包带 reproduce.py。冻结文件在运行 frozen/ 中，保持原样。\n'
                            write(task/'README.md', body); counts['tasks'] += 1
                    else:
                        location = '本次未生成任务目录'
                    summary += f"| {label} | {node['data']['kind']} | {result.get('status', '未执行')} | {location} |\n"
                if run.get('frozen'):
                    summary += '\n[冻结成果](frozen/) 保存当次审核的文件；下载入口在应用“运行与成果”。\n'
                summary += '\n调整定义后在 SciNode 中建立新运行，保留本次文件与审核记录。\n'
                write(root/'README.md', summary); counts['runs'] += 1
            write(workspace/'README.md', text); counts['projects'] += 1
    return counts


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True, type=Path)
    parser.add_argument('--previous-root', type=Path)
    parser.add_argument('--current-root', type=Path)
    args = parser.parse_args()
    if bool(args.previous_root) != bool(args.current_root):
        parser.error('目录迁移需要同时提供 previous-root 与 current-root')
    print(json.dumps(refresh(args.data_dir, args.previous_root, args.current_root), ensure_ascii=False))
