const DEFAULT_API_BASE_URL = '/api';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//.test(value);

export const API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
);

export const buildBackendUrl = (path: string) => {
  if (isAbsoluteHttpUrl(path)) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (!API_BASE_URL) {
    return normalizedPath;
  }

  if (isAbsoluteHttpUrl(API_BASE_URL)) {
    return `${API_BASE_URL}${normalizedPath}`;
  }

  if (normalizedPath === API_BASE_URL || normalizedPath.startsWith(`${API_BASE_URL}/`)) {
    return normalizedPath;
  }

  return `${API_BASE_URL}${normalizedPath}`;
};
