"""SciNode clinical analyses. Inputs and choices are recorded; no synthetic fallback."""
import json
import os
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from tabular_data import read_table


def markdown(frame):
    def cell(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')
    return '| ' + ' | '.join(map(cell, frame.columns)) + ' |\n|' + '|'.join(['---'] * len(frame.columns)) + '|\n' + ''.join(
        '| ' + ' | '.join(cell(v) for v in row) + ' |\n' for row in frame.itertuples(index=False, name=None))


def table_result(frame, out, name):
    frame.to_csv(out / (name + '.csv'), index=False, encoding='utf-8-sig')
    return markdown(frame)


def figures(fig, out, name):
    fig.savefig(out / (name + '.png'), dpi=180, bbox_inches='tight')
    fig.savefig(out / (name + '.pdf'), bbox_inches='tight')
    import matplotlib.pyplot as plt
    plt.close(fig)


def plot_module():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    return plt


def require_columns(frame, names):
    missing = [name for name in names if not name or name not in frame.columns]
    if missing:
        raise ValueError('请重新选择有效列：' + ', '.join(str(n) for n in missing))


def numeric(values, name):
    parsed = pd.to_numeric(values, errors='coerce')
    if (values.notna() & parsed.isna()).any() or np.isinf(parsed.dropna()).any():
        raise ValueError(f'{name} 含非数字或无穷值，请先清理或改为分类变量')
    return parsed.astype(float)


def binary(values, event):
    levels = set(values.dropna().astype(str))
    # CSV numeric fields may be inferred as float because of missing rows.
    def token(value):
        try:
            return str(float(value))
        except (ValueError, TypeError):
            return str(value)
    levels = {token(v) for v in levels}
    if len(levels) != 2 or token(event) not in levels:
        raise ValueError('结局必须恰有两个取值，且事件取值必须与数据一致')
    return values.map(lambda v: np.nan if pd.isna(v) else int(token(v) == token(event)))


def quality(frame, config, out):
    rows = []
    for name in frame:
        values = frame[name]
        outliers = None
        if pd.api.types.is_numeric_dtype(values):
            values = numeric(values, name)
            q1, q3 = values.quantile([.25, .75])
            outliers = int(((values < q1 - 1.5 * (q3 - q1)) | (values > q3 + 1.5 * (q3 - q1))).sum())
        rows.append({'variable': name, 'missing_n': int(values.isna().sum()), 'missing_percent': round(100 * values.isna().mean(), 2),
                     'outliers_IQR_n': outliers if outliers is not None else '不适用'})
    summary = {'rows': len(frame), 'columns': len(frame.columns), 'duplicate_rows': int(frame.duplicated().sum())}
    id_column = config.get('idColumn')
    if id_column:
        require_columns(frame, [id_column])
        summary.update({'duplicate_ID_rows': int(frame[id_column].dropna().duplicated(keep=False).sum()),
                        'missing_ID_rows': int(frame[id_column].isna().sum())})
    text = '# 数据质量体检\n\n' + json.dumps(summary, ensure_ascii=False) + '\n\n'
    text += table_result(pd.DataFrame(rows), out, 'data-quality')
    text += '\n异常值按 1.5×IQR 标记；原始记录保持原样。重复 ID 仅在选择 ID 列时检查。\n'
    return {'text': text, 'summary': summary}


def table_one(frame, config, out):
    continuous, categorical = config.get('continuous', []), config.get('categorical', [])
    group = config.get('group')
    names = continuous + categorical
    if not names or len(set(names)) != len(names):
        raise ValueError('请选择至少一个特征；连续变量与分类变量不能重复')
    require_columns(frame, names + ([group] if group else []))
    if group in names:
        raise ValueError('分组列不能同时作为基线特征')
    if group and frame[group].nunique() > 20:
        raise ValueError('分组超过 20 类，请核对分组变量，避免选择患者 ID')
    groups = list(frame.groupby(group, sort=True, observed=True)) if group else [('Overall', frame)]
    if not groups:
        raise ValueError('分组列全部缺失')
    rows, methods = [], []
    for name in continuous:
        values = numeric(frame[name], name)
        mode = config.get('continuousFormat', 'auto')
        p = None
        if mode == 'auto':
            tests = []
            for _, part in groups:
                sample = values.loc[part.index].dropna()
                if len(sample) < 3 or sample.nunique() < 2:
                    tests.append(0.)
                else:
                    tests.append(float(stats.shapiro(sample.sample(min(5000, len(sample)), random_state=2026)).pvalue))
            p = min(tests)
            mode = 'mean' if p >= .05 else 'median'
        row = {'variable': name, 'level': 'mean ± SD' if mode == 'mean' else 'median [Q1, Q3]'}
        methods.append({'variable': name, 'format': mode, 'minimum_group_Shapiro_p': p})
        for label, part in groups:
            data = values.loc[part.index].dropna()
            display = '未估计' if not len(data) else (f'{data.mean():.3g} ± {data.std(ddof=1):.3g}' if mode == 'mean' and len(data) >= 2
                else f'{data.median():.3g} [{data.quantile(.25):.3g}, {data.quantile(.75):.3g}]' if mode == 'median' else 'SD 未估计（n<2）')
            row[f'{label} (n={len(part)})'] = f'{display}; 有效 n={len(data)}; 缺失 {len(part)-len(data)}'
        if len(groups) == 2:
            a, b = [values.loc[part.index].dropna() for _, part in groups]
            denominator = np.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2)
            row['absolute_SMD'] = round(abs(a.mean()-b.mean()) / denominator, 4) if denominator > 0 else '未估计'
        rows.append(row)
    for name in categorical:
        if frame[name].nunique() > 20:
            raise ValueError(f'{name} 分类超过 20 类，请核对变量类型')
        for level in sorted(frame[name].dropna().unique(), key=str):
            row = {'variable': name, 'level': str(level)}
            proportions = []
            for label, part in groups:
                valid, count = int(part[name].notna().sum()), int((part[name] == level).sum())
                proportions.append(count / valid if valid else np.nan)
                row[f'{label} (n={len(part)})'] = f'{count} ({100*count/valid:.1f}%); 缺失 {len(part)-valid}' if valid else '全部缺失'
            if len(groups) == 2:
                a, b = proportions
                denominator = np.sqrt((a*(1-a)+b*(1-b))/2)
                row['absolute_SMD'] = round(abs(a-b)/denominator, 4) if denominator > 0 else (0 if a == b else '未估计')
            rows.append(row)
    excluded = int(frame[group].isna().sum()) if group else 0
    pd.DataFrame(methods).to_csv(out / 'table1-methods.csv', index=False)
    text = '# 基线特征表（Table 1）\n\n' + table_result(pd.DataFrame(rows), out, 'table1')
    text += f'\n总记录 {len(frame)}；分组缺失排除 {excluded}。分类百分比以该组非缺失人数为分母。'
    text += '\n两组比较报告绝对 SMD（连续变量使用均值差和两组方差的均值；分类变量逐水平计算），不按基线 P 值自动选择混杂因素。'
    text += '\n自动展示采用各组 Shapiro–Wilk 检验，最多抽取 5,000 条、固定种子 2026；任一组 P<0.05 或不足 3 条时使用中位数 [Q1, Q3]。具体选择保存在 table1-methods.csv。'
    return {'text': text, 'summary': {'rows': len(frame), 'group_missing': excluded, 'groups': len(groups), 'features': len(names)}}


def design(frame, covariates, categorical):
    if not covariates or len(set(covariates)) != len(covariates):
        raise ValueError('请指定不重复的预测因子或协变量')
    if not set(categorical) <= set(covariates):
        raise ValueError('分类协变量必须属于所选预测因子')
    data = frame[covariates].copy()
    for name in covariates:
        if name in categorical:
            if data[name].nunique() > 20:
                raise ValueError(f'{name} 分类超过 20 类，请排除标识符')
            data[name] = data[name].astype(str)
        else:
            data[name] = numeric(data[name], name)
    data = pd.get_dummies(data, columns=categorical, drop_first=True, dtype=float)
    if not len(data.columns) or any(data.nunique() <= 1):
        raise ValueError('模型包含常量或只有单一水平的变量，请调整预测因子')
    if len(data) <= len(data.columns) + 2:
        raise ValueError('有效样本数不足以拟合当前模型，请减少预测因子或补充数据')
    return data.astype(float)


def regression(frame, config, out):
    from statsmodels.tools.sm_exceptions import ConvergenceWarning, PerfectSeparationWarning
    covariates, categorical = config.get('covariates', []), config.get('categorical', [])
    outcome, time = config.get('outcome'), config.get('time')
    method = config.get('method', 'logistic')
    required = covariates + [outcome] + ([time] if method == 'cox' else [])
    require_columns(frame, required)
    if len(required) != len(set(required)):
        raise ValueError('结局、随访时间和预测因子不能重复')
    complete = frame.dropna(subset=required).copy()
    y = binary(complete[outcome], config.get('eventValue', '1'))
    x = design(complete, covariates, categorical)
    with warnings.catch_warnings():
        warnings.simplefilter('error', ConvergenceWarning)
        warnings.simplefilter('error', PerfectSeparationWarning)
        if method == 'logistic':
            import statsmodels.api as sm
            x = sm.add_constant(x, has_constant='add')
            model = sm.Logit(y, x).fit(disp=False, maxiter=200)
            if not model.mle_retvals.get('converged'):
                raise ValueError('Logistic 模型未收敛，请检查分离和共线性')
            confidence = model.conf_int()
            result = pd.DataFrame({'term': x.columns, 'OR': np.exp(model.params),
                                   'lower95': np.exp(confidence[0]), 'upper95': np.exp(confidence[1]), 'P': model.pvalues})
            result = result[result['term'] != 'const']
            effect = 'OR'
            (out / 'model-summary.txt').write_text(model.summary().as_text(), encoding='utf-8')
        elif method == 'cox':
            from lifelines import CoxPHFitter
            from lifelines.statistics import proportional_hazard_test
            from lifelines.exceptions import ConvergenceWarning as CoxWarning
            warnings.simplefilter('error', CoxWarning)
            duration = numeric(complete[time], time)
            if set(x.columns) & {'_duration', '_event'}:
                raise ValueError('变量名 _duration、_event 为内部保留字段，请更名')
            if (duration <= 0).any():
                raise ValueError('Cox 随访时间必须大于 0，请核对时间零点')
            x = x.assign(_duration=duration, _event=y)
            model = CoxPHFitter().fit(x, duration_col='_duration', event_col='_event')
            result = model.summary.reset_index().rename(columns={'covariate': 'term', 'exp(coef)': 'HR',
                          'exp(coef) lower 95%': 'lower95', 'exp(coef) upper 95%': 'upper95', 'p': 'P'})
            result = result[['term', 'HR', 'lower95', 'upper95', 'P']]
            effect = 'HR'
            proportional_hazard_test(model, x, time_transform='rank').summary.to_csv(out / 'proportional-hazards.csv')
        else:
            raise ValueError('回归方法请选择 logistic 或 cox')
    if not np.isfinite(result[[effect, 'lower95', 'upper95', 'P']].to_numpy()).all():
        raise ValueError('模型出现非有限估计，请检查样本量、完全分离或共线性')
    plt = plot_module()
    fig, ax = plt.subplots(figsize=(7, max(3, len(result)*.4)))
    ax.errorbar(result[effect], result['term'], xerr=[result[effect]-result.lower95, result.upper95-result[effect]], fmt='o', color='#12786f')
    ax.axvline(1, linestyle='--', color='gray'); ax.set_xscale('log'); ax.set_xlabel(effect + ' (95% CI)')
    figures(fig, out, 'forest')
    summary = {'rows': len(frame), 'analyzed': len(complete), 'excluded_missing': len(frame)-len(complete), 'events': int(y.sum()), 'method': method}
    text = '# 结局关联分析\n\n' + json.dumps(summary, ensure_ascii=False) + '\n\n' + table_result(result, out, 'regression')
    text += '\n采用完整病例分析；分类变量按排序后的首个水平为参照，设计矩阵列名记录在结果表。估计表示调整后的关联。'
    if effect == 'HR':
        text += '\n比例风险假设的 Schoenfeld 残差检验见 proportional-hazards.csv，需结合临床背景复核。'
    return {'text': text, 'summary': summary, 'figureCount': 1}


def survival(frame, config, out):
    from lifelines import KaplanMeierFitter
    from lifelines.statistics import multivariate_logrank_test
    from lifelines.plotting import add_at_risk_counts
    time, outcome, group = config.get('time'), config.get('outcome'), config.get('group')
    require_columns(frame, [time, outcome, group])
    if len({time, outcome, group}) != 3:
        raise ValueError('随访时间、事件和分组必须为不同列')
    data = frame.dropna(subset=[time, outcome, group]).copy()
    data[time] = numeric(data[time], time)
    if (data[time] < 0).any() or data[group].nunique() < 2 or data[group].nunique() > 20:
        raise ValueError('KM 需要 2–20 组，且随访时间不能为负')
    data['_event'] = binary(data[outcome], config.get('eventValue', '1'))
    plt = plot_module(); fig, ax = plt.subplots(figsize=(8, 5))
    fits, rows = [], []
    for label, part in data.groupby(group, sort=True, observed=True):
        fit = KaplanMeierFitter(label=str(label)).fit(part[time], part['_event'])
        fit.plot_survival_function(ax=ax, ci_show=True, show_censors=True)
        fits.append(fit)
        rows.append({'group': label, 'n': len(part), 'events': int(part['_event'].sum()),
                     'median_survival': float(fit.median_survival_time_) if np.isfinite(fit.median_survival_time_) else '未达到'})
    add_at_risk_counts(*fits, ax=ax)
    ax.set_xlabel('Follow-up (' + config.get('timeUnit', 'days') + ')'); ax.set_ylabel('Survival probability')
    test = multivariate_logrank_test(data[time], data[group], data['_event'])
    figures(fig, out, 'kaplan-meier')
    text = '# Kaplan–Meier 生存分析\n\n' + table_result(pd.DataFrame(rows), out, 'survival')
    text += f'\nLog-rank P={test.p_value:.6g}；完整病例 n={len(data)}；因缺失排除 {len(frame)-len(data)}。\n曲线含 95% CI、删失标记和风险人数表；这是未调整的组间比较。'
    return {'text': text, 'summary': {'analyzed': len(data), 'excluded_missing': len(frame)-len(data), 'logrank_P': float(test.p_value)}, 'figureCount': 1}


def prediction(frame, config, out):
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import OneHotEncoder, StandardScaler
    from sklearn.pipeline import make_pipeline
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import roc_auc_score, brier_score_loss, roc_curve
    from sklearn.calibration import calibration_curve
    from sklearn.exceptions import ConvergenceWarning
    import joblib
    covariates, categorical = config.get('covariates', []), config.get('categorical', [])
    outcome, identifier = config.get('outcome'), config.get('idColumn')
    require_columns(frame, covariates + [outcome, identifier])
    if not covariates or len(set(covariates)) != len(covariates) or outcome in covariates or identifier in covariates or outcome == identifier:
        raise ValueError('预先指定预测因子，排除结局和患者 ID')
    if not set(categorical) <= set(covariates):
        raise ValueError('分类预测因子必须来自所选预测因子')
    if frame[identifier].isna().any() or frame[identifier].duplicated().any():
        raise ValueError('该模板要求每位患者一行且 ID 完整唯一；重复记录需先按患者整理')
    data = frame.dropna(subset=[outcome]).copy()
    y = binary(data[outcome], config.get('eventValue', '1'))
    continuous = [name for name in covariates if name not in categorical]
    for name in continuous:
        data[name] = numeric(data[name], name)
    for name in categorical:
        if data[name].nunique() > 20:
            raise ValueError(f'{name} 分类超过 20 类，请排除患者标识符')
        data[name] = data[name].map(lambda value: str(value) if pd.notna(value) else np.nan)
    fraction, seed = float(config.get('testFraction', .25)), int(config.get('seed', 2026))
    if not .2 <= fraction <= .5 or len(data) < 40 or y.value_counts().min() < 8:
        raise ValueError('验证比例需为 20%–50%，样本至少 40，且两类结局各至少 8；正式样本量需按研究方案确认')
    train_x, test_x, train_y, test_y = train_test_split(data[covariates], y, test_size=fraction, random_state=seed, stratify=y)
    if train_x.isna().all().any() or any(train_x.nunique() < 2):
        raise ValueError('训练集中有全缺失或常量预测因子，请调整变量')
    transforms = []
    if continuous:
        transforms.append(('numeric', make_pipeline(SimpleImputer(strategy='median'), StandardScaler()), continuous))
    if categorical:
        transforms.append(('categorical', make_pipeline(SimpleImputer(strategy='most_frequent'), OneHotEncoder(handle_unknown='ignore', drop='first')), categorical))
    model = make_pipeline(ColumnTransformer(transforms), LogisticRegression(max_iter=2000, random_state=seed))
    with warnings.catch_warnings():
        warnings.simplefilter('error', ConvergenceWarning)
        model.fit(train_x, train_y)
    probability = model.predict_proba(test_x)[:, 1]
    auc = float(roc_auc_score(test_y, probability)); brier = float(brier_score_loss(test_y, probability))
    rng, boot = np.random.default_rng(seed), []
    observed = test_y.to_numpy()
    for _ in range(500):
        indices = rng.integers(0, len(test_y), len(test_y))
        if len(np.unique(observed[indices])) == 2:
            boot.append(roc_auc_score(observed[indices], probability[indices]))
    low, high = [float(value) for value in np.quantile(boot, [.025, .975])]
    frac_positive, mean_predicted = calibration_curve(test_y, probability, n_bins=5, strategy='quantile')
    calibration = pd.DataFrame({'mean_predicted': mean_predicted, 'observed_fraction': frac_positive})
    calibration.to_csv(out / 'calibration.csv', index=False)
    rows = []
    for threshold in np.linspace(.05, .8, 31):
        selected = probability >= threshold
        net = (np.sum(selected & (observed == 1)) - np.sum(selected & (observed == 0))*threshold/(1-threshold)) / len(observed)
        rows.append({'threshold': threshold, 'model_net_benefit': net,
                     'treat_all': observed.mean() - (1-observed.mean())*threshold/(1-threshold), 'treat_none': 0})
    dca = pd.DataFrame(rows); dca.to_csv(out / 'decision-curve.csv', index=False)
    plt = plot_module(); fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    fpr, tpr, _ = roc_curve(test_y, probability)
    axes[0].plot(fpr, tpr, label=f'AUC={auc:.3f}'); axes[0].plot([0, 1], [0, 1], '--', color='gray')
    axes[0].set(xlabel='False positive rate', ylabel='True positive rate'); axes[0].legend()
    axes[1].plot(mean_predicted, frac_positive, 'o-'); axes[1].plot([0, 1], [0, 1], '--', color='gray')
    axes[1].set(xlabel='Predicted probability', ylabel='Observed fraction', xlim=(0, 1), ylim=(0, 1))
    for name in ['model_net_benefit', 'treat_all', 'treat_none']:
        axes[2].plot(dca.threshold, dca[name], label=name)
    axes[2].set(xlabel='Threshold probability', ylabel='Net benefit'); axes[2].legend()
    figures(fig, out, 'prediction-validation')
    joblib.dump(model, out / 'prediction-model.joblib')
    pd.DataFrame({'feature': ['intercept', *model[0].get_feature_names_out()], 'coefficient': [float(model[1].intercept_[0]), *model[1].coef_[0]]}).to_csv(out / 'coefficients.csv', index=False)
    summary = {'training_n': len(train_y), 'validation_n': len(test_y), 'training_events': int(train_y.sum()),
               'validation_events': int(test_y.sum()), 'excluded_missing_outcome': len(frame)-len(data),
               'AUC': auc, 'AUC_lower95': low, 'AUC_upper95': high, 'Brier': brier, 'seed': seed, 'validation': 'internal_holdout'}
    text = '# 预测模型内部验证\n\n' + table_result(pd.DataFrame([summary]), out, 'prediction-metrics')
    text += '\n预先指定预测因子；按患者分层随机划分训练/验证集，训练集内拟合中位数/众数插补、标准化和分类编码。模型为 L2 正则 Logistic（C=1）。'
    text += '\nAUC 95% CI 使用验证集 500 次自助抽样百分位区间；Brier、分箱校准曲线与 DCA 均来自留出的验证集。'
    text += '\n这是单次内部留出验证；报告应说明样本量依据、预期用途和后续外部验证计划。阈值 0.05–0.80 为展示范围，需按临床决策场景确认。'
    return {'text': text, 'summary': summary, 'figureCount': 1}


def analyze(params, out):
    config = params.get('analysis') or {}
    path = params.get('dataPath') or params.get('filePath')
    if not path:
        raise ValueError('请选择数据表，或接入上游临床表格的数据文件')
    frame = read_table(path, config.get('sheet') or params.get('sheet'))
    method = params.get('analysisPreset')
    handlers = {'quality': quality, 'table1': table_one, 'regression': regression, 'km': survival, 'prediction': prediction}
    if method not in handlers:
        raise ValueError('请选择有效的临床统计任务')
    result = handlers[method](frame, config, out)
    result['n'] = len(frame)
    result.setdefault('figureCount', 0)
    (out / 'report.md').write_text(result['text'], encoding='utf-8')
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    output = Path(os.environ['SCINODE_OUTPUT'])
    output.mkdir(parents=True, exist_ok=True)
    inputs = json.loads(Path(os.environ['SCINODE_INPUT']).read_text(encoding='utf-8'))
    result = analyze(inputs, output)
    print(result['text'])
