export const MAX_REVIEW_PARSE_DEPTH = 6;

export interface ReviewParseIssue {
  path: string;
  message: string;
}

export interface ParsedReviewContent {
  value: unknown;
  parsedStringCount: number;
  issues: ReviewParseIssue[];
  depthLimitedPaths: string[];
  maxDepth: number;
}

const looksLikeJson = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"');
};

const childPath = (path: string, key: string | number): string => {
  if (typeof key === 'number') return `${path}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
};

/**
 * Parses JSON embedded in string fields while keeping the caller's raw input untouched.
 * Parsing stops at maxDepth; the original value remains available for the raw view.
 */
export function parseReviewContent(input: unknown, maxDepth = MAX_REVIEW_PARSE_DEPTH): ParsedReviewContent {
  const safeMaxDepth = Number.isFinite(maxDepth) ? Math.max(0, Math.floor(maxDepth)) : MAX_REVIEW_PARSE_DEPTH;
  const issues: ReviewParseIssue[] = [];
  const depthLimitedPaths: string[] = [];
  let parsedStringCount = 0;

  const visit = (value: unknown, path: string, depth: number, ancestors: Set<object>): unknown => {
    if (typeof value === 'string' && looksLikeJson(value)) {
      if (depth >= safeMaxDepth) {
        depthLimitedPaths.push(path);
        return value;
      }

      try {
        const parsed = JSON.parse(value) as unknown;
        parsedStringCount += 1;
        return visit(parsed, path, depth + 1, ancestors);
      } catch (error) {
        // JSON.parse failures are surfaced to the review UI, and the original string stays intact.
        if (error instanceof SyntaxError) {
          issues.push({ path, message: error.message.slice(0, 240) });
        }
        return value;
      }
    }

    if (!value || typeof value !== 'object') return value;
    if (ancestors.has(value)) {
      issues.push({ path, message: '检测到循环引用，当前层保留原始内容' });
      return value;
    }
    if (depth >= safeMaxDepth) {
      depthLimitedPaths.push(path);
      return value;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    if (Array.isArray(value)) {
      return value.map((item, index) => visit(item, childPath(path, index), depth + 1, nextAncestors));
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, visit(child, childPath(path, key), depth + 1, nextAncestors)]),
    );
  };

  return {
    value: visit(input, '$', 0, new Set<object>()),
    parsedStringCount,
    issues,
    depthLimitedPaths,
    maxDepth: safeMaxDepth,
  };
}

export function formatReviewValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const formatted = JSON.stringify(value, null, 2);
    return formatted === undefined ? String(value) : formatted;
  } catch {
    return String(value);
  }
}
