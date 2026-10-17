'use client';

import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, FileText, Image as ImageIcon } from '@phosphor-icons/react/dist/ssr';
import { IconButton } from '@/components/ui';
import styles from './markdown.module.css';

/**
 * Assistant prose. Memoised on `content` because a streaming turn re-renders on
 * every coalesced token frame and markdown parsing is not free.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className={styles.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
          a: ({ children, href }) =>
            href && isPanelFile(href) ? (
              // A file or screenshot the run produced: cite it as a chip.
              <a href={href} target="_blank" rel="noreferrer" className={styles.cite}>
                {/\.(png|jpe?g|webp|gif)$/i.test(href) || /screenshot/i.test(String(children)) ? (
                  <ImageIcon size={12} aria-hidden />
                ) : (
                  <FileText size={12} aria-hidden />
                )}
                {children}
              </a>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
          table: ({ children }) => (
            <div className={styles.tableWrap}>
              <table>{children}</table>
            </div>
          ),
          img: ({ src, alt }) =>
            typeof src === 'string' ? (
              <a href={src} target="_blank" rel="noreferrer" className={styles.figure}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={alt ?? ''} loading="lazy" />
              </a>
            ) : null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function isPanelFile(href: string): boolean {
  return href.startsWith('/api/uploads/') || href.startsWith('/api/files/');
}

interface CodeProps {
  className?: string;
  children?: React.ReactNode;
}

function CodeBlock({ className, children }: CodeProps) {
  const text = String(children ?? '').replace(/\n$/, '');
  const language = /language-(\w+)/.exec(className ?? '')?.[1];

  // react-markdown routes inline code here too; only fenced blocks get a
  // language class, which is the reliable way to tell them apart.
  if (!language && !text.includes('\n')) {
    return <code className={styles.inline}>{text}</code>;
  }

  return (
    <figure className={styles.block}>
      <figcaption className={styles.blockHead}>
        <span className={styles.lang}>{language ?? 'text'}</span>
        <CopyButton text={text} />
      </figcaption>
      <Highlighted code={text} language={language} />
    </figure>
  );
}

/**
 * Shiki is loaded on demand and only for the languages actually present, which
 * keeps it out of the initial bundle. Plain text renders immediately and is
 * replaced once highlighting resolves.
 */
function Highlighted({ code, language }: { code: string; language?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { codeToHtml } = await import('shiki');
        const result = await codeToHtml(code, {
          lang: language ?? 'text',
          themes: { dark: 'github-dark-default', light: 'github-light' },
          defaultColor: false,
        });
        if (!cancelled) setHtml(result);
      } catch {
        // An unknown language is not an error worth surfacing; plain text is a
        // perfectly good fallback.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    return <div className={styles.shiki} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <pre className={styles.plain}>
      <code>{code}</code>
    </pre>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <IconButton
      label={copied ? 'Copied' : 'Copy code'}
      size="sm"
      icon={copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    />
  );
}
