'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Product, type ProductRef } from '@/lib/api';
import { cn } from './ui';
import { teamColor } from './brand';

/*
 * How a system shows up on every screen: its logo, or its initials on its colour when it has none.
 * Rows from the API carry only { id, slug, name }; the look (colour, logo) comes from the product
 * list, which the console already keeps cached under ['products'].
 */

export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/staff/products'), staleTime: 60_000 });
}

/** The full product behind a row's reference, once the list has loaded. */
export function useProduct(ref: Pick<ProductRef, 'id'> | null | undefined): Product | undefined {
  const products = useProducts();
  return React.useMemo(() => products.data?.find((p) => p.id === ref?.id), [products.data, ref?.id]);
}

/** The cached product with whatever the caller passes on top (a form being edited shows live). */
function useLook<T extends Pick<ProductRef, 'id'>>(product: T | null | undefined): (Partial<Product> & T) | undefined {
  const full = useProduct(product);
  if (!product) return undefined;
  return full ? { ...full, ...product } : product;
}

/** The colour the system chose, or the one its slug picks. */
export function productColor(p: { slug?: string | null; color?: string | null } | null | undefined): string {
  return p?.color ?? teamColor(p?.slug);
}

/** Dark or light text, whichever reads on a chosen #rrggbb (WCAG relative luminance). */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.22 ? '#0b0c0d' : '#ffffff';
}

export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The system's badge: a square with the logo on white (logos are drawn for light paper), or the
 * initials on the system's colour. Decorative next to the name; pass `label` when it stands alone.
 */
export function ProductMark({ product, size = 20, label, className }: {
  product: (Pick<ProductRef, 'id' | 'slug' | 'name'> & Partial<Pick<Product, 'color' | 'logoUrl'>>) | null | undefined;
  size?: number; label?: boolean; className?: string;
}) {
  const p = useLook(product);
  const logo = p?.logoUrl;
  const [broken, setBroken] = React.useState<string | null>(null);
  const box = { width: size, height: size } as React.CSSProperties;
  const a11y = label && p ? { role: 'img', 'aria-label': p.name, title: p.name } : { 'aria-hidden': true };

  if (logo && broken !== logo) {
    return (
      <span {...a11y} className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden bg-white', className)}
        style={{ ...box, padding: size >= 40 ? Math.round(size * 0.1) : size >= 24 ? 2 : 1 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" width={size} height={size} decoding="async" onError={() => setBroken(logo)} className="size-full object-contain" />
      </span>
    );
  }
  const color = productColor(p);
  // Two letters only where they can be read; a small badge keeps the first.
  const text = size < 28 ? initials(p?.name ?? '?')[0] : initials(p?.name ?? '?');
  return (
    <span {...a11y} className={cn('display inline-flex shrink-0 items-center justify-center leading-none', className)}
      style={{ ...box, background: color, color: color.startsWith('#') ? inkOn(color) : 'var(--ds-on-status)', fontSize: Math.round(size * (text.length > 1 ? 0.42 : 0.6)) }}>
      <span className="translate-y-[0.06em]">{text}</span>
    </span>
  );
}

/** Badge + name, for the places a row says which system it belongs to. */
export function ProductName({ product, size = 18, className }: { product: ProductRef | null | undefined; size?: number; className?: string }) {
  if (!product) return null;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <ProductMark product={product} size={size} />
      <span className="truncate">{product.name}</span>
    </span>
  );
}

/** The thin colour band at the left of a row: the system's colour, chosen or derived. */
export function ProductStripe({ product, className }: { product: Pick<ProductRef, 'id' | 'slug'> | null | undefined; className?: string }) {
  return <span aria-hidden className={cn('shrink-0', className)} style={{ background: productColor(useLook(product)) }} />;
}

/** Colours that read on both grounds, beside the yellow of the brand (kept for the brand alone). */
export const PRODUCT_COLORS = ['#5eb0ff', '#2cc4c9', '#34d08c', '#a3d93b', '#ff9b3d', '#ff5f52', '#ff6fae', '#b9a2ff'];

/** Swatches, the automatic colour (from the slug) and a free pick. `value` null = automatic. */
export function ColorPicker({ value, slug, onChange, disabled }: { value: string | null; slug: string; onChange: (c: string | null) => void; disabled?: boolean }) {
  const swatch = (selected: boolean) => cn('size-9 shrink-0 outline-offset-2 transition-transform duration-150 enabled:hover:-translate-y-0.5 disabled:opacity-60', selected ? 'outline-2 outline-fg' : 'outline-0');
  const custom = value !== null && !PRODUCT_COLORS.includes(value);
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Cor do sistema">
      <button type="button" role="radio" aria-checked={value === null} disabled={disabled} onClick={() => onChange(null)}
        className={cn(swatch(value === null), 'w-auto px-3 text-[13px] font-semibold')} style={{ background: teamColor(slug), color: 'var(--ds-on-status)' }}
        title="Escolhida a partir do identificador">Automática</button>
      {PRODUCT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} disabled={disabled} onClick={() => onChange(c)}
          className={swatch(value === c)} style={{ background: c }} />
      ))}
      <label className={cn(swatch(custom), 'relative cursor-pointer overflow-hidden bg-chip')} title="Outra cor" style={custom ? { background: value! } : undefined}>
        {!custom && <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[18px] leading-none text-fg-muted">+</span>}
        <input type="color" disabled={disabled} value={value ?? '#5eb0ff'} onChange={(e) => onChange(e.target.value)} aria-label="Outra cor"
          className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
    </div>
  );
}
