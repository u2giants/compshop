import { useCallback, useRef } from "react";

const EDGE_ZONE = 60; // px from top/bottom edge to trigger scroll
const SCROLL_SPEED = 12; // px per frame

export function useDragAutoScroll() {
  const scrollRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const handleDragOverScroll = useCallback((e: React.DragEvent) => {
    const container = scrollRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const y = e.clientY;
    const distFromTop = y - rect.top;
    const distFromBottom = rect.bottom - y;

    let direction = 0;
    if (distFromTop < EDGE_ZONE) direction = -1;
    else if (distFromBottom < EDGE_ZONE) direction = 1;

    if (direction === 0) {
      stopAutoScroll();
      return;
    }

    if (rafRef.current !== null) return; // already scrolling

    function tick() {
      if (!container) return;
      container.scrollTop += direction * SCROLL_SPEED;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stopAutoScroll]);

  return { scrollRef, handleDragOverScroll, stopAutoScroll };
}
