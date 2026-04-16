"use client";

import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Image as ImageIcon,
  File,
} from "lucide-react";
import { cn } from "@/lib/utils";

const formatConfig: Record<
  string,
  { icon: typeof FileText; color: string; bg: string }
> = {
  pdf: { icon: FileText, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950" },
  docx: { icon: FileText, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950" },
  pptx: { icon: Presentation, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950" },
  xlsx: { icon: FileSpreadsheet, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950" },
  hwp: { icon: FileText, color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-950" },
  txt: { icon: FileText, color: "text-gray-600", bg: "bg-gray-50 dark:bg-gray-800" },
  jpg: { icon: ImageIcon, color: "text-pink-600", bg: "bg-pink-50 dark:bg-pink-950" },
  jpeg: { icon: ImageIcon, color: "text-pink-600", bg: "bg-pink-50 dark:bg-pink-950" },
  png: { icon: ImageIcon, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-950" },
};

export function FileFormatIcon({
  format,
  size = "md",
}: {
  format: string;
  size?: "sm" | "md" | "lg";
}) {
  const config = formatConfig[format] || {
    icon: File,
    color: "text-gray-500",
    bg: "bg-gray-50",
  };
  const Icon = config.icon;

  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  const containerClasses = {
    sm: "h-7 w-7",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg",
        containerClasses[size],
        config.bg
      )}
    >
      <Icon className={cn(sizeClasses[size], config.color)} />
    </div>
  );
}

export function FileFormatBadge({ format }: { format: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
      <FileFormatIcon format={format} size="sm" />
      {format}
    </span>
  );
}
