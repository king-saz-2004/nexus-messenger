import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../services/apiClient';

type MediaState = {
  url?: string;
  blob?: Blob;
  isLoading: boolean;
  downloadProgress: number;
  error?: string;
  reload: () => void;
};

export const useAuthenticatedMedia = (sourceUrl?: string): MediaState => {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(undefined);
  const [resolvedBlob, setResolvedBlob] = useState<Blob | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadTick, setReloadTick] = useState(0);
  const objectUrlRef = useRef<string | null>(null);

  const cleanupObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!sourceUrl) {
      cleanupObjectUrl();
      setResolvedUrl(undefined);
      setResolvedBlob(undefined);
      setError(undefined);
      setIsLoading(false);
      setDownloadProgress(0);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    setIsLoading(true);
    setDownloadProgress(0);
    setError(undefined);

    void apiClient
      .fetchMediaBlob(sourceUrl, controller.signal, percent => {
        if (!isCancelled) {
          setDownloadProgress(percent);
        }
      })
      .then(blob => {
        if (isCancelled) return;
        cleanupObjectUrl();
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setResolvedUrl(objectUrl);
        setResolvedBlob(blob);
      })
      .catch(err => {
        if (isCancelled) return;
        if ((err as Error).name === 'AbortError') return;
        setResolvedUrl(undefined);
        setResolvedBlob(undefined);
        setError(err instanceof Error ? err.message : 'Unable to load media');
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [cleanupObjectUrl, reloadTick, sourceUrl]);

  useEffect(() => {
    return () => {
      cleanupObjectUrl();
    };
  }, [cleanupObjectUrl]);

  const reload = useCallback(() => {
    setReloadTick(prev => prev + 1);
  }, []);

  return useMemo(
    () => ({
      url: resolvedUrl,
      blob: resolvedBlob,
      isLoading,
      downloadProgress,
      error,
      reload
    }),
    [error, isLoading, downloadProgress, resolvedUrl, resolvedBlob, reload]
  );
};
