import { useState, useCallback } from 'react';

export const useApi = <T,>(endpoint: string, options: RequestInit = {}) => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const execute = useCallback(async (body: any = null) => {
    setIsLoading(true);
    setError(null);
    try {
      const finalHeaders = new Headers({ 'Content-Type': 'application/json' });
      if (options.headers) {
        new Headers(options.headers).forEach((value, key) => {
          finalHeaders.set(key, value);
        });
      }

      const response = await fetch(endpoint, {
        ...options,
        headers: finalHeaders,
        body: body ? JSON.stringify(body) : null,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error ${response.status}`);
      }
      // Handle no-content responses (e.g., logout)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return null;
      }
      const result = await response.json();
      setData(result);
      return result;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [endpoint, JSON.stringify(options)]);

  return { data, error, isLoading, execute };
};
