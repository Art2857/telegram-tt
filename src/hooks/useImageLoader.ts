import { useEffect, useRef } from '../lib/teact/teact';

import { preloadImage } from '../util/files';
import useAsync from './useAsync';

export type UseImageLoaderResult = {
  image?: HTMLImageElement;
  error?: Error;
};

export default function useImageLoader(file?: Blob): UseImageLoaderResult {
  const urlRef = useRef<string | undefined>();

  const { result } = useAsync<UseImageLoaderResult & { file?: Blob }>(async () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = undefined;
    }
    if (!file) return { file };

    const url = URL.createObjectURL(file);
    urlRef.current = url;

    try {
      return { file, image: await preloadImage(url) };
    } catch (err) {
      return { file, error: err instanceof Error ? err : new Error('Invalid image') };
    }
  }, [file]);

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = undefined;
      }
    };
  }, []);

  return result && result.file === file ? { image: result.image, error: result.error } : {};
}
