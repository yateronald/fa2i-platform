const API_BASE_URL =
  process.env.NEXT_PUBLIC_APP_BASE_URL || 'http://localhost:4000';

export function resolveMediaUrl(ref) {
  if (!ref || typeof ref !== 'string') return '';

  const value = ref.trim();
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    return value;
  }

  const base = API_BASE_URL.replace(/\/$/, '');
  const path = value.startsWith('/') ? value : `/${value}`;
  return `${base}${path}`;
}
