"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";

const breadcrumbMap: Record<string, string> = {
  "/documents": "문서 관리",
  "/search": "RAG 검색",
};

function getBreadcrumb(pathname: string): string[] {
  if (pathname.startsWith("/documents/") && pathname !== "/documents") {
    return ["문서 관리", "문서 상세"];
  }
  return [breadcrumbMap[pathname] || ""];
}

export function Header() {
  const pathname = usePathname();
  const crumbs = getBreadcrumb(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <nav className="flex items-center gap-2 text-sm">
        {crumbs.map((crumb, index) => (
          <span key={index} className="flex items-center gap-2">
            {index > 0 && (
              <Separator orientation="vertical" className="h-4" />
            )}
            <span
              className={
                index === crumbs.length - 1
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              }
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}
