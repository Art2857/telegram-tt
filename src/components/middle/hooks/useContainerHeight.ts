import type { ElementRef } from '../../../lib/teact/teact';
import { useRef, useSignal } from '../../../lib/teact/teact';

import useLastCallback from '../../../hooks/useLastCallback';
import useResizeObserver from '../../../hooks/useResizeObserver';

export default function useContainerHeight(containerRef: ElementRef<HTMLDivElement>) {
  const [getContainerHeight, setContainerHeight] = useSignal<number | undefined>();

  const handleResize = useLastCallback((entry: ResizeObserverEntry) => {
    setContainerHeight(entry.contentRect.height);
  });

  useResizeObserver(containerRef, handleResize);

  const prevContainerHeightRef = useRef<number>();

  return [getContainerHeight, prevContainerHeightRef] as const;
}
