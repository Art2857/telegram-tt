import type { ElementRef } from '../lib/teact/teact';
import { useEffect, useState } from '../lib/teact/teact';

import type { TabWithProperties } from '../components/ui/TabList';

import { requestMutation } from '../lib/fasterdom/fasterdom';
import useLastCallback from './useLastCallback';

const HOLD_DURATION_MS = 450;
const MOVE_THRESHOLD = 8;
const SCROLL_EDGE = 32;
const SCROLL_STEP = 16;

type Options = {
  containerRef: ElementRef<HTMLDivElement>;
  tabs: readonly TabWithProperties[];
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onContextMenu: (index: number, element: HTMLElement, x: number, y: number) => void;
  onDragStart: () => void;
};

/** Короткий свайп листает полосу; удержание открывает меню и позволяет переставить папку */
export default function useTabReorder({ containerRef, tabs, onReorder, onContextMenu, onDragStart }: Options) {
  const [draggingIndex, setDraggingIndex] = useState<number>();
  const [dropIndex, setDropIndex] = useState<number>();
  const isEnabled = Boolean(tabs.length && (onReorder || tabs.some((tab) => tab.contextActions?.length)));
  const canReorder = useLastCallback((from: number, to: number) => (
    Boolean(onReorder && tabs[from]?.reorderGroup
      && tabs[from].reorderGroup === tabs[to]?.reorderGroup)
  ));
  const openContextMenu = useLastCallback(onContextMenu);
  const startDrag = useLastCallback(onDragStart);
  const finishDrag = useLastCallback((from: number, to: number) => onReorder?.(from, to));

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isEnabled) return undefined;
    let gesture: {
      index: number; targetIndex: number; element: HTMLElement; x: number; y: number;
      isTouch: boolean; isHeld: boolean; isDragging: boolean;
    } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let suppressClickUntil = 0;

    function clearTimer() {
      clearTimeout(timer);
      timer = undefined;
    }

    function endGesture(e?: Event) {
      clearTimer();
      const current = gesture;
      gesture = undefined;
      if (!current) return;
      if (current.isHeld || current.isDragging) {
        suppressClickUntil = performance.now() + HOLD_DURATION_MS;
        if (e?.cancelable) e.preventDefault();
      }
      setDraggingIndex(undefined);
      setDropIndex(undefined);
      if (current.isDragging && e && e.type !== 'touchcancel' && e.type !== 'blur'
        && current.index !== current.targetIndex && canReorder(current.index, current.targetIndex)) {
        finishDrag(current.index, current.targetIndex);
      }
    }

    function beginGesture(e: MouseEvent | TouchEvent) {
      if ('button' in e && e.button !== 0) return;
      if ('touches' in e && e.touches.length !== 1) {
        endGesture();
        return;
      }
      const element = (e.target as HTMLElement).closest<HTMLElement>('[data-tab-index]');
      if (!element || !container!.contains(element)) return;
      clearTimer();
      const point = 'touches' in e ? e.touches[0] : e;
      const index = Number(element.dataset.tabIndex);
      const current = {
        index, targetIndex: index, element, x: point.clientX, y: point.clientY,
        isTouch: 'touches' in e, isHeld: false, isDragging: false,
      };
      gesture = current;
      timer = setTimeout(() => {
        current.isHeld = true;
        const rect = element.getBoundingClientRect();
        openContextMenu(index, element, current.x, rect.bottom);
      }, HOLD_DURATION_MS);
    }

    function moveGesture(e: MouseEvent | TouchEvent) {
      const current = gesture;
      if (!current) return;
      if ('touches' in e && e.touches.length !== 1) {
        endGesture();
        return;
      }
      const point = 'touches' in e ? e.touches[0] : e;
      const distance = Math.hypot(point.clientX - current.x, point.clientY - current.y);
      if (!current.isDragging && distance < MOVE_THRESHOLD) return;
      clearTimer();
      if ((current.isTouch && !current.isHeld) || !canReorder(current.index, current.index)) {
        endGesture();
        return;
      }
      if (e.cancelable) e.preventDefault();
      if (!current.isDragging) {
        current.isDragging = true;
        startDrag();
        setDraggingIndex(current.index);
      }
      const rect = container!.getBoundingClientRect();
      const candidates = Array.from(container!.querySelectorAll<HTMLElement>(':scope > [data-tab-index]'))
        .filter((element) => canReorder(current.index, Number(element.dataset.tabIndex)));
      const closest = candidates.reduce<HTMLElement | undefined>((best, element) => {
        const center = (item: HTMLElement) => (
          rect.left + item.offsetLeft - container!.scrollLeft + item.offsetWidth / 2
        );
        return !best || Math.abs(center(element) - point.clientX) < Math.abs(center(best) - point.clientX)
          ? element : best;
      }, undefined);
      current.targetIndex = closest ? Number(closest.dataset.tabIndex) : current.index;
      setDropIndex(current.targetIndex);
      const scroll = point.clientX < rect.left + SCROLL_EDGE ? -SCROLL_STEP
        : point.clientX > rect.right - SCROLL_EDGE ? SCROLL_STEP : 0;
      if (scroll) requestMutation(() => container!.scrollBy({ left: scroll }));
    }

    function suppressClick(e: MouseEvent) {
      if (performance.now() >= suppressClickUntil) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    container.addEventListener('mousedown', beginGesture);
    container.addEventListener('touchstart', beginGesture, { passive: true });
    container.addEventListener('click', suppressClick, true);
    document.addEventListener('mousemove', moveGesture);
    document.addEventListener('touchmove', moveGesture, { passive: false });
    document.addEventListener('mouseup', endGesture);
    document.addEventListener('touchend', endGesture, { passive: false });
    document.addEventListener('touchcancel', endGesture);
    window.addEventListener('blur', endGesture);
    return () => {
      endGesture();
      container.removeEventListener('mousedown', beginGesture);
      container.removeEventListener('touchstart', beginGesture);
      container.removeEventListener('click', suppressClick, true);
      document.removeEventListener('mousemove', moveGesture);
      document.removeEventListener('touchmove', moveGesture);
      document.removeEventListener('mouseup', endGesture);
      document.removeEventListener('touchend', endGesture);
      document.removeEventListener('touchcancel', endGesture);
      window.removeEventListener('blur', endGesture);
    };
  }, [containerRef, isEnabled, canReorder, openContextMenu, startDrag, finishDrag]);

  return { draggingIndex, dropIndex };
}
