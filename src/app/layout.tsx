import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { FeedbackProvider } from "@/components/common/FeedbackProvider";

export const metadata: Metadata = {
  title: "PageDock — AI PDF 공부 도구",
  description: "PDF를 읽고, 표시하고, AI와 함께 연구하세요.",
  icons: { icon: '/pagedock-mark.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <body className="h-full bg-surface" suppressHydrationWarning>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
