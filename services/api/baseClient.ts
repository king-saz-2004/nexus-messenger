import { API_BASE } from '../config';

const CSRF_COOKIE_NAME = ((import.meta as any).env?.VITE_CSRF_COOKIE_NAME?.toString().trim() || 'csrfToken').trim();

const parseErrorMessage = (payload: any) => {
  if (Array.isArray(payload?.issues) && payload.issues.length > 0) {
    return payload.issues
      .map((issue: { message?: string }) => issue.message)
      .filter(Boolean)
      .join(', ');
  }
  return payload?.message || 'Request failed';
};

export type ApiClientError = Error & {
  code?: string;
  status?: number;
  payload?: any;
};

const readCookie = (name: string) => {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  if (!cookie) return null;
  const raw = cookie.slice(name.length + 1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export const getApiBase = () => API_BASE;

export const getCsrfToken = () => readCookie(CSRF_COOKIE_NAME);

export const refreshSession = async () => {
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include'
  });
  return response.ok;
};

export type RequestOptions = {
  method?: string;
  body?: any;
  headers?: HeadersInit;
  signal?: AbortSignal;
  retryOnUnauthorized?: boolean;
};

export const request = async <T = any>(path: string, options: RequestOptions = {}): Promise<T> => {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  const isForm = options.body instanceof FormData;
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isMutating) {
    const csrfToken = getCsrfToken();
    if (csrfToken && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  if (options.body !== undefined && !isForm && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: options.body === undefined ? undefined : isForm ? options.body : JSON.stringify(options.body),
    signal: options.signal
  });

  if (response.status === 401 && options.retryOnUnauthorized !== false) {
    let refreshed = false;
    try {
      refreshed = await refreshSession();
    } catch {
      refreshed = false;
    }
    if (refreshed) {
      return request<T>(path, { ...options, retryOnUnauthorized: false });
    }
  }

  if (response.status === 204) {
    return {} as T;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(parseErrorMessage(payload)) as ApiClientError;
    error.code = typeof payload?.code === 'string' ? payload.code : undefined;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload as T;
};

export const resolveResourceUrl = (pathOrUrl: string) => {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (pathOrUrl.startsWith('/')) {
    return `${API_BASE}${pathOrUrl}`;
  }
  return `${API_BASE}/${pathOrUrl}`;
};

export const requestBlob = async (
  pathOrUrl: string,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
  retryOnUnauthorized = true
): Promise<Blob> => {
  const response = await fetch(resolveResourceUrl(pathOrUrl), {
    method: 'GET',
    credentials: 'include',
    signal
  });

  if (response.status === 401 && retryOnUnauthorized) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return requestBlob(pathOrUrl, signal, onProgress, false);
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Media not found');
    }
    throw new Error('Unable to load media');
  }

  if (!onProgress || !response.body) {
    return response.blob();
  }

  const reader = response.body.getReader();
  const contentLength = Number(response.headers.get('content-length')) || 0;
  let receivedLength = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      receivedLength += value.length;
      if (contentLength > 0) {
        onProgress(Math.round((receivedLength / contentLength) * 100));
      }
    }
  }

  const mimeType = response.headers.get('content-type') || undefined;
  return new Blob(chunks, { type: mimeType });
};
