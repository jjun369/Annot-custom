import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface ChatMarkdownProps {
  content: string;
  fontSize?: number;
  className?: string;
}

export function normalizeMathMarkdown(content: string): string {
  return content
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}

export function ChatMarkdown({ content, fontSize = 14, className }: ChatMarkdownProps) {
  const codeFontSize = Math.max(11, fontSize - 2);
  const codeFontStyle = { fontSize: `${codeFontSize}px` };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children, className: codeClassName }) => {
            const isBlock = Boolean(codeClassName);
            if (isBlock) {
              return (
                <code
                  className="block overflow-x-auto rounded-lg bg-surface-container px-3 py-2 font-functional"
                  style={codeFontStyle}
                >
                  {children}
                </code>
              );
            }

            return (
              <code className="rounded bg-surface-container px-1.5 py-0.5 font-functional" style={codeFontStyle}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mb-3 last:mb-0">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-outline-variant pl-3 text-on-surface-variant last:mb-0">
              {children}
            </blockquote>
          ),
        }}
      >
        {normalizeMathMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
