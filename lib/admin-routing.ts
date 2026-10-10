const adminHostnames = new Set(['admin.splash.xyz', 'admin.localhost']);

export function isAdminHostname(hostname: string | null | undefined) {
  const normalized = hostname?.split(':')[0]?.toLowerCase();

  return Boolean(normalized && adminHostnames.has(normalized));
}

export function adminConsolePath(path: string, hostname: string | null | undefined) {
  const normalizedPath = path === '/' ? '' : path;

  if (isAdminHostname(hostname)) {
    return normalizedPath || '/';
  }

  return normalizedPath ? `/admin${normalizedPath}` : '/admin';
}
