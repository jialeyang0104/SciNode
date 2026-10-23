import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Card, Collapse, Empty, Input, Space, Statistic, Tag, Tabs, Typography } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatReviewValue, parseReviewContent } from './ApprovalReviewParser';
import './ApprovalReview.css';

const { TextArea } = Input;
const { Text } = Typography;

export interface ApprovalReviewProps {
  input: unknown;
  artifacts?: unknown[];
  summary?: string;
  decisions?: unknown;
  status?: string;
  projectName?: string;
  runId?: string;
  revision?: number;
  busy?: boolean;
  note?: string;
  onNoteChange?: (note: string) => void;
  onApprove?: (note: string) => void | Promise<void>;
  onReturn?: (note: string) => void | Promise<void>;
  actionError?: string;
}

type ContentCategory = '修订与补丁' | '审阅与证据' | '科学数据' | '文件与来源' | '其他材料';
type ContentEntry = { key: string; path: string; value: unknown; category: ContentCategory };
type PatchGroup = { paths: string[]; patches: unknown[] };

const categoryOrder: ContentCategory[] = ['修订与补丁', '审阅与证据', '科学数据', '文件与来源', '其他材料'];
const categoryFor = (key: string, value: unknown): ContentCategory => {
  const name = key.toLowerCase();
  if (/patch|revision|original|replacement|revised|diff|change|修订|补丁|原文/.test(name) || containsPatchList(value)) return '修订与补丁';
  if (/review|evidence|check|question|plan|decision|opinion|assessment|audit|复核|审阅|证据|计划|问题|判断/.test(name)) return '审阅与证据';
  if (/data|dataset|cohort|variable|outcome|result|analysis|model|sample|statistic|estimate|endpoint|科学|数据|队列|变量|结局|结果|分析|模型|样本|统计|估计/.test(name)) return '科学数据';
  if (/file|path|artifact|sha|hash|source|document|attachment|文件|路径|成果|哈希|来源|文档|附件/.test(name)) return '文件与来源';
  return '其他材料';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containsPatchList(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    (/patch/i.test(key) && Array.isArray(child)) || containsPatchList(child, depth + 1),
  );
}

function entriesFor(value: unknown): Array<{ key: string; path: string; value: unknown }> {
  if (Array.isArray(value)) return value.map((item, index) => ({ key: `第 ${index + 1} 项`, path: `$[${index}]`, value: item }));
  if (isRecord(value)) {
    return Object.entries(value).map(([key, child]) => ({
      key,
      path: /^[A-Za-z_$][\w$]*$/.test(key) ? `$.${key}` : `$[${JSON.stringify(key)}]`,
      value: child,
    }));
  }
  return value === undefined ? [] : [{ key: '材料内容', path: '$', value }];
}

function collectPatchGroups(value: unknown): PatchGroup[] {
  const groups: PatchGroup[] = [];
  const visit = (current: unknown, path: string, depth: number) => {
    if (depth > 10 || !current || typeof current !== 'object' || Array.isArray(current)) return;
    Object.entries(current).forEach(([key, child]) => {
      const childKey = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
      if (/patch/i.test(key) && Array.isArray(child)) {
        const signature = formatReviewValue(child);
        const duplicate = groups.find(group => formatReviewValue(group.patches) === signature);
        if (duplicate) duplicate.paths.push(childKey);
        else groups.push({ paths: [childKey], patches: child });
      } else {
        visit(child, childKey, depth + 1);
      }
    });
  };
  visit(value, '$', 0);
  return groups;
}

const patchField = (value: Record<string, unknown>, names: string[]): unknown => {
  const target = names.find(name => value[name] !== undefined);
  return target ? value[target] : undefined;
};

function PatchCard({ item, index, open, onOpenChange }: { item: unknown; index: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const record = isRecord(item) ? item : undefined;
  const ordinal = record?.index ?? index + 1;
  const original = record ? patchField(record, ['original', 'before', 'old', 'source', 'originalText']) : undefined;
  const revised = record ? patchField(record, ['text', 'revised', 'replacement', 'after', 'new', 'updated', 'revisedText']) : undefined;
  const title = typeof ordinal === 'number' || typeof ordinal === 'string' ? `段落 ${ordinal}` : `修订项 ${index + 1}`;
  return (
    <details className="approval-patch" open={open} onToggle={event => onOpenChange(event.currentTarget.open)} key={`${title}-${index}`}>
      <summary>
        <strong>{title}</strong>
        <span>{original !== undefined && revised !== undefined ? '原文与修订稿' : '修订材料'}</span>
      </summary>
      {original !== undefined && revised !== undefined ? (
        <div className="approval-diff-grid">
          <section><h5>原文</h5><pre>{formatReviewValue(original)}</pre></section>
          <section><h5>修订稿</h5><pre>{formatReviewValue(revised)}</pre></section>
        </div>
      ) : (
        <div className="approval-structured-value">{renderStructured(item, `修订项 ${index + 1}`, 0)}</div>
      )}
      {record && Object.keys(record).some(key => !['index', 'original', 'before', 'old', 'source', 'originalText', 'text', 'revised', 'replacement', 'after', 'new', 'updated', 'revisedText'].includes(key)) && (
        <details className="approval-extra-fields">
          <summary>该项的其他字段</summary>
          <pre>{formatReviewValue(Object.fromEntries(Object.entries(record).filter(([key]) => !['index', 'original', 'before', 'old', 'source', 'originalText', 'text', 'revised', 'replacement', 'after', 'new', 'updated', 'revisedText'].includes(key))))}</pre>
        </details>
      )}
    </details>
  );
}

function renderStructured(value: unknown, path: string, depth: number, fieldName = ''): ReactNode {
  if (typeof value === 'string') {
    const markdownField = /review|plan|summary|report|assessment|audit|evidence|复核|审阅|计划|报告|证据/i.test(fieldName);
    const markdownText = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s)|(^|\n)\s*\|[^\n]+\|\s*$|\*\*[^*]+\*\*/m.test(value);
    if (markdownField && markdownText) {
      return <div className="approval-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown></div>;
    }
    if (value.length > 500 || value.includes('\n')) {
      return <details className="approval-long-text"><summary>{value.length.toLocaleString()} 字 · 展开内容</summary><pre>{value}</pre></details>;
    }
    return <div className="approval-scalar">{value || <Text type="secondary">空字符串</Text>}</div>;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return <div className="approval-scalar">{value === null ? 'null' : String(value)}</div>;
  }
  if (value === undefined) return <Text type="secondary">字段未提供</Text>;

  if (depth >= 6) {
    return <details className="approval-depth-limit"><summary>已达到结构化展开上限 · {path} · 展开本层完整内容</summary><pre>{formatReviewValue(value)}</pre></details>;
  }
  if (Array.isArray(value)) {
    return value.length ? (
      <ol className="approval-value-list">{value.map((item, index) => <li key={`${path}-${index}`}>{renderStructured(item, `${path}[${index}]`, depth + 1)}</li>)}</ol>
    ) : <Text type="secondary">空列表</Text>;
  }

  const fields = Object.entries(value as Record<string, unknown>);
  if (!fields.length) return <Text type="secondary">空对象</Text>;
  return (
    <dl className="approval-field-list">
      {fields.map(([key, child]) => (
        <div key={`${path}-${key}`} className="approval-field">
          <dt>{key}</dt>
          <dd>{/patch/i.test(key) && Array.isArray(child)
            ? <Text type="secondary">{child.length} 项已在“修订与补丁”中逐项展示</Text>
            : renderStructured(child, `${path}.${key}`, depth + 1, key)}</dd>
        </div>
      ))}
    </dl>
  );
}

function decisionTitle(value: unknown): string {
  if (!isRecord(value)) return '决策记录';
  if (value.action === 'stop') return '运行已结束';
  if (value.approved === true) return '已确认并继续';
  if (value.approved === false) return '已退回修改';
  return typeof value.action === 'string' ? value.action : '决策记录';
}

function decisionSearchText(value: unknown): string {
  return formatReviewValue(value).toLocaleLowerCase();
}

function DecisionHistory({ decisions, query }: { decisions: unknown; query: string }) {
  const items = Array.isArray(decisions) ? decisions : decisions == null ? [] : [decisions];
  const filtered = items.map((item, index) => ({ item, index })).filter(({ item }) => !query || decisionSearchText(item).includes(query));
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前运行尚无人工决策记录" />;
  if (!filtered.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的决策记录" />;

  return (
    <ol className="approval-decision-list">
      {filtered.slice().reverse().map(({ item, index }) => {
        const record = isRecord(item) ? item : undefined;
        const note = record?.note;
        const known = new Set(['action', 'approved', 'note', 'by', 'at', 'nodeId']);
        const extra = record ? Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key))) : undefined;
        return (
          <li key={`decision-${index}`}>
            <Card size="small" className="approval-decision-card">
              <div className="approval-decision-head">
                <Tag color={record?.approved === true ? 'green' : record?.approved === false || record?.action === 'stop' ? 'orange' : 'default'}>{decisionTitle(item)}</Tag>
                <span>{typeof record?.at === 'string' ? record.at : ''}</span>
              </div>
              <div className="approval-decision-meta">
                {typeof record?.by === 'string' && <span>处理人：{record.by}</span>}
                {typeof record?.nodeId === 'string' && <span>节点：{record.nodeId}</span>}
              </div>
              {note !== undefined && <div className="approval-decision-note">{renderStructured(note, `decision-${index}.note`, 0)}</div>}
              {extra && Object.keys(extra).length > 0 && <details><summary>其他记录字段</summary>{renderStructured(extra, `decision-${index}.extra`, 0)}</details>}
              {!record && <pre>{formatReviewValue(item)}</pre>}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

const statusLabel: Record<string, string> = {
  WAITING_APPROVAL: '等待确认', SUCCESS: '已完成', REJECTED: '已退回', RUNNING: '执行中',
  QUEUED: '排队中', PAUSED: '已暂停', FAILED: '执行失败', INTERRUPTED: '运行中断', CANCELLED: '已结束',
};

export function ApprovalReview({
  input,
  artifacts = [],
  summary,
  decisions,
  status,
  projectName,
  runId,
  revision,
  busy = false,
  note,
  onNoteChange,
  onApprove,
  onReturn,
  actionError,
}: ApprovalReviewProps) {
  const [localNote, setLocalNote] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [expandedPatchKeys, setExpandedPatchKeys] = useState<Set<string> | null>(null);
  const query = queryInput.trim().toLocaleLowerCase();
  const parsed = useMemo(() => parseReviewContent(input), [input]);
  const entries = useMemo(() => [
    ...entriesFor(parsed.value),
    ...artifacts.map((artifact, index) => ({ key: '关联成果文件', path: `$.artifacts[${index}]`, value: artifact })),
  ], [parsed.value, artifacts]);
  const patchGroups = useMemo(() => collectPatchGroups(parsed.value), [parsed.value]);
  const decisionItems = Array.isArray(decisions) ? decisions.length : decisions == null ? 0 : 1;
  const rawNote = note ?? localNote;
  const grouped = useMemo(() => {
    const groups = new Map<ContentCategory, ContentEntry[]>();
    entries.forEach(({ key, path, value }) => {
      if (query && !`${key} ${path} ${formatReviewValue(value)}`.toLocaleLowerCase().includes(query)) return;
      const category = categoryFor(key, value);
      groups.set(category, [...(groups.get(category) || []), { key, path, value, category }]);
    });
    return groups;
  }, [entries, query]);
  const visiblePatchGroups = useMemo(() => patchGroups.map(group => ({
    ...group,
    patches: group.patches.filter((patch, index) => !query || `${group.paths.join(' ')} ${formatReviewValue(patch)} ${index + 1}`.toLocaleLowerCase().includes(query)),
  })).filter(group => group.patches.length > 0 || !query), [patchGroups, query]);
  const visiblePatchKeys = useMemo(() => visiblePatchGroups.flatMap(group => { const original=patchGroups.find(item=>item.paths.join('|')===group.paths.join('|')); return group.patches.map(patch => `${group.paths.join('|')}-${original?.patches.indexOf(patch)}`); }), [visiblePatchGroups, patchGroups]);
  useEffect(() => {
    if (!query || visiblePatchKeys.length === 0) return;
    setExpandedPatchKeys(current => {
      const next = new Set(current || []);
      visiblePatchKeys.forEach(key => next.add(key));
      return next;
    });
  }, [query, visiblePatchKeys]);
  const reviewCount = grouped.get('审阅与证据')?.length || 0;
  const hasActions = status === 'WAITING_APPROVAL' && Boolean(onApprove || onReturn);
  const filteredDecisionCount = Array.isArray(decisions)
    ? decisions.filter(decision => !query || decisionSearchText(decision).includes(query)).length
    : decisions == null ? 0 : (!query || decisionSearchText(decisions).includes(query) ? 1 : 0);

  const handleNoteChange = (value: string) => {
    if (note === undefined) setLocalNote(value);
    onNoteChange?.(value);
  };

  const collapseItems = categoryOrder.flatMap(category => {
    const categoryEntries = grouped.get(category) || [];
    if (!categoryEntries.length) return [];
    return [{
      key: category,
      label: <span>{category}<Tag className="approval-count-tag">{categoryEntries.length}</Tag></span>,
      children: <div className="approval-entry-grid">{categoryEntries.map(entry => (
        <Card size="small" key={entry.path} className="approval-entry-card" title={<span>{entry.key}<Text type="secondary"> · {entry.path}</Text></span>}>
          {renderStructured(entry.value, entry.path, 0, entry.key)}
        </Card>
      ))}</div>,
    }];
  });

  return (
    <section className="approval-review" aria-label="人工确认结构化审阅">
      <div className="approval-review-heading">
        <div>
          <span className="approval-review-eyebrow">STRUCTURED REVIEW</span>
          <h3>人工确认材料</h3>
          <p>{projectName || '科研运行'}{runId ? ` · 运行 ${runId.slice(0, 8)}` : ''}</p>
        </div>
        <Space wrap>
          {typeof revision === 'number' && <Tag color="blue">运行版本 v{revision}</Tag>}
          {status && <Tag color={status === 'WAITING_APPROVAL' ? 'orange' : status === 'SUCCESS' ? 'green' : 'default'}>{statusLabel[status] || status}</Tag>}
        </Space>
      </div>

      {summary && <Card size="small" className="approval-review-summary"><Text strong>本次确认事项</Text><p>{summary}</p></Card>}

      <div className="approval-review-stats">
        <Statistic title="材料字段" value={entries.length} />
        <Statistic title="修订项" value={patchGroups.reduce((total, group) => total + group.patches.length, 0)} />
        <Statistic title="已解析 JSON 字符串" value={parsed.parsedStringCount} />
        <Statistic title="决策历史" value={decisionItems} />
      </div>

      {(parsed.issues.length > 0 || parsed.depthLimitedPaths.length > 0) && (
        <Space direction="vertical" className="approval-review-diagnostics" size={8}>
          {parsed.issues.length > 0 && <Alert type="error" showIcon message="部分内容解析失败，原文已保留" description={<ul>{parsed.issues.map((issue, index) => <li key={`${issue.path}-${index}`}><strong>{issue.path}</strong>：{issue.message}</li>)}</ul>} />}
          {parsed.depthLimitedPaths.length > 0 && <Alert type="info" showIcon message={`结构化解析达到 ${parsed.maxDepth} 层上限`} description={`已保留这些位置的完整原始内容：${parsed.depthLimitedPaths.join('、')}`} />}
        </Space>
      )}

      <Input.Search
        allowClear
        value={queryInput}
        onChange={event => setQueryInput(event.target.value)}
        onSearch={setQueryInput}
        placeholder="检索材料、原文、修订稿与决策记录"
        className="approval-review-search"
      />

      <Tabs className="approval-content-tabs" defaultActiveKey={patchGroups.length?'patches':'materials'} items={[
        {key:'patches',label:`修订对照 (${patchGroups.reduce((total, group) => total + group.patches.length, 0)})`,children:<div className="approval-panel-scroll"><>
        <section className="approval-review-section">
          <div className="approval-section-heading">
            <h4>修订补丁对比</h4>
            <Tag color="blue">{patchGroups.reduce((total, group) => total + group.patches.length, 0)} 项</Tag>
            <Tag>结构化审阅 {reviewCount} 项</Tag>
            <Button size="small" type="link" onClick={() => setExpandedPatchKeys(new Set(visiblePatchKeys))}>展开全部</Button>
            <Button size="small" type="link" onClick={() => setExpandedPatchKeys(new Set())}>收起全部</Button>
          </div>
          {visiblePatchGroups.map(group => (
            <div className="approval-patch-group" key={group.paths.join('|')}>


              <div className="approval-patch-list">{group.patches.map((patch, index) => {
                const original=patchGroups.find(item=>item.paths.join('|')===group.paths.join('|'));
                const key = `${group.paths.join('|')}-${original?.patches.indexOf(patch)}`;
                const isOpen = expandedPatchKeys ? expandedPatchKeys.has(key) : !query && group === visiblePatchGroups[0] && index === 0;
                return <PatchCard key={key} item={patch} index={index} open={isOpen} onOpenChange={open => setExpandedPatchKeys(current => { const next = new Set(current || []); if (open) next.add(key); else next.delete(key); return next; })} />;
              })}</div>
            </div>
          ))}
        </section>
      </></div>},
        {key:'materials',label:'AI复核与材料',children:<div className="approval-panel-scroll"><section className="approval-review-section">
        <div className="approval-section-heading"><h4>材料内容</h4><Tag>{grouped.size ? [...grouped.values()].reduce((sum, items) => sum + items.length, 0) : 0} 个字段</Tag><Tag>结构化审阅 {reviewCount} 项</Tag></div>
        {collapseItems.length > 0 ? <Collapse items={collapseItems} defaultActiveKey={collapseItems.map(item => item.key)} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '没有匹配的材料字段' : '当前运行没有待审阅材料'} />}
      </section></div>},
        {key:'decisions',label:`决策记录 (${decisionItems})`,children:<div className="approval-panel-scroll"><section className="approval-review-section approval-history-section">
        <div className="approval-section-heading"><h4>决策历史</h4><Tag>{filteredDecisionCount}/{decisionItems} 条</Tag></div>
        <DecisionHistory decisions={decisions} query={query} />
      </section></div>},
      ]}/>

      {hasActions && (
        <section className="approval-review-actions">
          <label htmlFor="approval-review-note">确认意见或退回原因 <span>*</span></label>
          <TextArea id="approval-review-note" rows={2} value={rawNote} onChange={event => handleNoteChange(event.target.value)} placeholder="记录本次判断、依据、待补材料或退回修改意见" />
          {actionError && <Alert type="error" showIcon message={actionError} />}
          <Space wrap>
            {onApprove && <Button type="primary" loading={busy} disabled={busy || !rawNote.trim()} onClick={() => onApprove(rawNote.trim())}>确认并继续</Button>}
            {onReturn && <Button danger loading={busy} disabled={busy || !rawNote.trim()} onClick={() => onReturn(rawNote.trim())}>退回修改</Button>}
          </Space>
        </section>
      )}

      <details className="approval-review-raw">
        <summary>查看原始输入内容（保留接口收到的完整结构）</summary>
        <pre>{formatReviewValue(input)}</pre>
        {artifacts.length > 0 && <details className="approval-raw-artifacts"><summary>查看关联成果文件的原始记录</summary><pre>{formatReviewValue(artifacts)}</pre></details>}
      </details>
    </section>
  );
}

export default ApprovalReview;
