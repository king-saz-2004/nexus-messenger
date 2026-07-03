export const resolveApiBase = () => {
  const configured = (import.meta as any).env?.VITE_API_BASE?.toString().trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  if (typeof window !== 'undefined') {
    const origin = window.location.origin.toLowerCase();
    if (origin.includes('localhost:3000') || origin.includes('127.0.0.1:3000')) {
      return 'http://localhost:4000';
    }
  }

  return '';
};

export const API_BASE = resolveApiBase().replace(/\/$/, '');
