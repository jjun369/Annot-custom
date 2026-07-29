import Image from 'next/image';

interface PageDockMarkProps {
  size?: number;
  className?: string;
}

export function PageDockMark({ size = 28, className = '' }: PageDockMarkProps) {
  return (
    <Image
      src="/pagedock-mark.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={className}
      priority
    />
  );
}
