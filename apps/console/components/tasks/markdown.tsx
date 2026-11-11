'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/components/ui';

/*
 * Markdown as the task's body and comments carry it. No rehype-raw: HTML in the text is shown as
 * text, never rendered, and react-markdown's URL filter already drops javascript: and friends.
 * Links leave the console in a new tab without a handle back to it.
 */

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-fg underline underline-offset-2 hover:no-underline">{children}</a>
  ),
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-[17px] font-semibold tracking-[-0.01em] text-fg first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-4 mb-2 text-[16px] font-semibold tracking-[-0.01em] text-fg first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 mb-1.5 text-[15px] font-semibold text-fg first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-fg-muted">{children}</blockquote>,
  code: ({ className, children }) => <code className={cn('rounded-md bg-well px-1.5 py-0.5', className)}>{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-tile bg-well p-4 text-[12.5px] [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
  table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="text-[13px]">{children}</table></div>,
  th: ({ children }) => <th className="px-2 py-1 text-left text-[12px] font-normal text-fg-subtle">{children}</th>,
  td: ({ children }) => <td className="border-t border-border-subtle px-2 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-border" />,
  img: ({ alt }) => <span className="text-fg-muted">[imagem: {alt}]</span>,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('min-w-0 text-[14px] leading-[1.6] break-words text-fg-secondary', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  );
}
