"""Build a portable, indexed package; retain frozen records and original path mappings."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import zipfile


def build_package(params, out):
    target = out / 'research-package.zip'
    temporary = out / '.research-package.zip.tmp'
    manifest = {'formatVersion': 2, 'files': []}
    names = set()
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
            def add(name, data, original=None):
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or name in names:
                    raise ValueError('成果包路径无效或重复：' + name)
                names.add(name)
                archive.writestr(name, data)
                entry = {'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}
                if original:
                    entry['originalPath'] = original
                    aliases = {original, str(Path(original).resolve())}
                    old, new = os.environ.get('SCINODE_PREVIOUS_ROOT'), os.environ.get('SCINODE_CURRENT_ROOT')
                    if old and new and original.startswith(new + '/'):
                        aliases.add(old + original[len(new):])
                    entry['originalPaths'] = sorted(aliases)
                manifest['files'].append(entry)
            for index, artifact in enumerate(params.get('artifacts', [])):
                source = Path(artifact['path'])
                data = source.read_bytes()
                if hashlib.sha256(data).hexdigest() != artifact['sha256']:
                    raise ValueError('成果文件校验失败：' + source.name)
                name = artifact.get('relativePath') or f"tasks/{artifact['nodeId']}/legacy/{index:03d}_{source.name}"
                add(name, data, artifact.get('originalPath', artifact['path']))
            for source in params.get('definition', {}).get('files', []):
                path = Path(source['path']); data = path.read_bytes()
                if hashlib.sha256(data).hexdigest() != source['sha256']:
                    raise ValueError('输入文件校验失败：' + source['name'])
                add('inputs/' + source['id'] + '_' + Path(source['name']).name, data, source['path'])
            for key, name in [('definition', 'workflow'), ('nodeResults', 'node-results'), ('decisions', 'decisions'),
                              ('models', 'models'), ('settingsSnapshot', 'settings'), ('runInputs', 'run-inputs')]:
                add(f'config/{name}.json', json.dumps(params.get(key, {}), ensure_ascii=False, indent=2).encode())
            add('reproduce.py', Path(__file__).with_name('reproduce.py').read_bytes())
            text = '# ' + params.get('definition', {}).get('name', '科研任务') + '\n\n先按下表审阅结果，再查看对应任务的代码与配置。\n\n'
            text += '| 任务 ID | 任务 | 状态 | 入口 |\n|---|---|---|---|\n'
            for node in params.get('definition', {}).get('nodes', []):
                nid = node['id']; result = params.get('nodeResults', {}).get(nid, {})
                name = node['data'].get('label', nid).replace('|', '\\|')
                kind = node.get('data', {}).get('kind')
                # This archive exists only once its producing task has succeeded.
                if kind == 'package' and nid == out.parent.name and not result.get('status'):
                    status = 'SUCCESS'
                    link = '本成果包由此节点生成'
                else:
                    status = result.get('status', '未执行')
                    link = f'[任务说明](tasks/{nid}/README.md)' if f'tasks/{nid}/README.md' in names else '本次未执行或历史记录无独立代码'
                text += f"| {nid} | {name} | {status} | {link} |\n"
            text += '\n## 文件与复现\n\n- `inputs/`：导入原件；`tasks/任务ID/`：配置、实际脚本、日志和输出。\n'
            text += '- `config/`：工作流定义、模型标识、任务输入、结果与人工决策；`manifest.json`：文件哈希及原路径。\n'
            text += '- 对照任务 `config/environment.json`、`requirements.txt` 准备 Python 环境；R 任务参照 `logs/session-info.log`。\n'
            text += '- 运行 `python reproduce.py 任务ID --output /绝对路径/空目录`；可用 `--python` 或 `--rscript` 指定解释器。\n'
            text += '- 复现入口先检查全部文件哈希，再把已登记输入及上游产物的绝对路径改为包内路径。自定义脚本使用的外部数据库、绝对路径和服务需按原配置准备。\n'
            text += '- 模型、联网检索及人工确认保留本次结果和来源；在 SciNode 中重新调用会产生新的运行记录。\n'
            text += '\n保留原件、人工决策和已审阅输出。复现输出写到包外指定空目录。临床数据原件随本地成果包保存。\n'
            add('README.md', text.encode())
            archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return {'text': '成果包已生成：按任务包含代码、配置、输入、结果与复现说明', 'fileName': target.name, 'manifest': manifest}
