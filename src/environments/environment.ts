/**
 * Ambiente di produzione (default, usato quando nessuna fileReplacement lo
 * sostituisce). Sostituire `apiBaseUrl` con l'URL reale del backend prima
 * del deploy.
 */
export const environment = {
  production: true,
  apiBaseUrl: 'http://localhost:8000/api',
};
