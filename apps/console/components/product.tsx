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

export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The pale tint and the deep ink of a system's colour, so a badge reads on either theme. */
export function productTint(color: string) {
  return {
    background: `color-mix(in srgb, ${color} 17%, var(--ds-bg-surface))`,
    color: `color-mix(in srgb, ${color} 72%, var(--ds-fg-primary))`,
  };
}

/**
 * The system's badge: a rounded square with the logo on white (logos are drawn for light paper), or
 * the initials in the system's colour on a pale tint of it. Decorative next to the name; pass
 * `label` when it stands alone.
 */
export function ProductMark({ product, size = 20, label, className }: {
  product: (Pick<ProductRef, 'id' | 'slug' | 'name'> & Partial<Pick<Product, 'color' | 'logoUrl'>>) | null | undefined;
  size?: number; label?: boolean; className?: string;
}) {
  const p = useLook(product);
  const logo = p?.logoUrl;
  const [broken, setBroken] = React.useState<string | null>(null);
  const radius = Math.round(size * 0.3);
  const box = { width: size, height: size, borderRadius: radius } as React.CSSProperties;
  const a11y = label && p ? { role: 'img', 'aria-label': p.name, title: p.name } : { 'aria-hidden': true };

  if (logo && broken !== logo) {
    return (
      <span {...a11y} className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-white', className)}
        style={{ ...box, padding: size >= 40 ? Math.round(size * 0.12) : size >= 24 ? 3 : 1 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" width={size} height={size} decoding="async" onError={() => setBroken(logo)} className="size-full object-contain" />
      </span>
    );
  }
  const color = productColor(p);
  // Two letters only where they can be read; a small badge keeps the first.
  const text = size < 28 ? initials(p?.name ?? '?')[0] : initials(p?.name ?? '?');
  return (
    <span {...a11y} className={cn('inline-flex shrink-0 items-center justify-center leading-none font-bold', className)}
      style={{ ...box, ...productTint(color), fontSize: Math.round(size * (text.length > 1 ? 0.38 : 0.5)) }}>
      {text}
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

/** A thin rounded band (or a dot, sized by the caller) in the system's colour, chosen or derived. */
export function ProductStripe({ product, className }: { product: Pick<ProductRef, 'id' | 'slug'> | null | undefined; className?: string }) {
  return <span aria-hidden className={cn('shrink-0 rounded-full', className)} style={{ background: productColor(useLook(product)) }} />;
}

/** Mid-tone colours whose tint and ink read on both themes; the yellow stays the brand's alone. */
export const PRODUCT_COLORS = ['#2f62b5', '#17707c', '#1e7b4f', '#6b8a12', '#b0660f', '#c4242a', '#b03f78', '#5b6b7a'];

/** Swatches, the automatic colour (from the slug) and a free pick. `value` null = automatic. */
export function ColorPicker({ value, slug, onChange, disabled }: { value: string | null; slug: string; onChange: (c: string | null) => void; disabled?: boolean }) {
  const swatch = (selected: boolean) => cn('size-9 shrink-0 rounded-full outline-offset-2 transition-transform duration-150 enabled:hover:scale-105 disabled:opacity-60', selected ? 'outline-2 outline-fg' : 'outline-0');
  const custom = value !== null && !PRODUCT_COLORS.includes(value);
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Cor do sistema">
      <button type="button" role="radio" aria-checked={value === null} disabled={disabled} onClick={() => onChange(null)}
        className={cn(swatch(value === null), 'w-auto px-3.5 text-[13px] font-semibold')} style={productTint(teamColor(slug))}
        title="Escolhida a partir do identificador">Automática</button>
      {PRODUCT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} disabled={disabled} onClick={() => onChange(c)}
          className={swatch(value === c)} style={{ background: c }} />
      ))}
      <label className={cn(swatch(custom), 'relative cursor-pointer overflow-hidden border border-dashed border-border-strong bg-surface')} title="Outra cor" style={custom ? { background: value! } : undefined}>
        {!custom && <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[18px] leading-none text-fg-muted">+</span>}
        <input type="color" disabled={disabled} value={value ?? '#2f62b5'} onChange={(e) => onChange(e.target.value)} aria-label="Outra cor"
          className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
    </div>
  );
}
