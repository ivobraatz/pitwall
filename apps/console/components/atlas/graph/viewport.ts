'use client';

import * as React from 'react';

/** The size of the box a map is drawn in, kept current. The map mounts only once it is known. */
export function useBox<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [box, setBox] = React.useState<{ w: number; h: number } | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}
