"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { FileFormatIcon } from "@/components/documents/file-format-icon";
import { searchDocuments } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { SearchResponse, SearchResult } from "@/types";
import {
  Search,
  FileText,
  Sparkles,
  Blend,
  BarChart3,
  ArrowDown,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface AllSearchResults {
  bm25: SearchResponse | null;
  vector: SearchResponse | null;
  hybrid: SearchResponse | null;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (tokens.length === 0) return text;

  const pattern = new RegExp(`(${tokens.join("|")})`, "gi");
  const parts = text.split(pattern);

  return parts.map((part, i) =>
    pattern.test(part) ? (
      <mark
        key={i}
        className="rounded bg-yellow-200 px-0.5 font-medium text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<AllSearchResults | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error("검색어를 입력해주세요");
      return;
    }

    const trimmed = query.trim();
    setIsSearching(true);
    setErrorMessage(null);
    try {
      const [bm25, vector, hybrid] = await Promise.all([
        searchDocuments({ query: trimmed, method: "bm25", top_k: topK }),
        searchDocuments({ query: trimmed, method: "vector", top_k: topK }),
        searchDocuments({ query: trimmed, method: "hybrid", top_k: topK }),
      ]);
      setResults({ bm25, vector, hybrid });
      setSubmittedQuery(trimmed);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "검색에 실패했습니다";
      setErrorMessage(msg);
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">RAG 검색</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          BM25와 Vector 검색 결과를 결합하여 Hybrid 최종 결과를 제공합니다.
        </p>
      </div>

      {/* Search Input */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <Textarea
              placeholder="검색어를 입력하세요... (Shift+Enter로 줄바꿈)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[80px] resize-none"
            />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">결과 수:</span>
                <div className="flex gap-1">
                  {[3, 5, 10, 20].map((k) => (
                    <Button
                      key={k}
                      variant={topK === k ? "default" : "outline"}
                      size="sm"
                      className="h-7 w-10 text-xs"
                      onClick={() => setTopK(k)}
                    >
                      {k}
                    </Button>
                  ))}
                </div>
              </div>

              <Button
                onClick={handleSearch}
                disabled={!query.trim() || isSearching}
                className="gap-2"
              >
                <Search className="h-4 w-4" />
                {isSearching ? "검색 중..." : "검색"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {!isSearching && errorMessage && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    검색을 수행할 수 없습니다
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {errorMessage}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSearch}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  다시 시도
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {isSearching && <SearchSkeleton />}

      {!isSearching && results && (
        <div className="space-y-6">
          {/* BM25 + Vector (2열) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* BM25 */}
            <ResultColumn
              title="BM25"
              subtitle="키워드 기반 검색"
              icon={<FileText className="h-4 w-4" />}
              response={results.bm25}
              color="blue"
              query={submittedQuery}
            />

            {/* Vector */}
            <ResultColumn
              title="Vector"
              subtitle="의미 기반 검색"
              icon={<Sparkles className="h-4 w-4" />}
              response={results.vector}
              color="purple"
              query={submittedQuery}
            />
          </div>

          {/* 화살표 */}
          <div className="flex items-center justify-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <div className="flex items-center gap-2 rounded-full border bg-muted px-4 py-1.5">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                BM25 + Vector 결합
              </span>
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Hybrid (최종 결과) */}
          <ResultColumn
            title="Hybrid"
            subtitle="최종 검색 결과"
            icon={<Blend className="h-4 w-4" />}
            response={results.hybrid}
            color="emerald"
            isFinal
            query={submittedQuery}
          />
        </div>
      )}

      {/* Initial State */}
      {!isSearching && !results && !errorMessage && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="mt-4 text-sm font-medium">검색어를 입력하세요</p>
            <p className="mt-1 text-sm text-muted-foreground">
              BM25, Vector 검색 후 Hybrid로 최종 결과를 확인할 수 있습니다.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const colorMap = {
  blue: {
    badge: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300",
    header: "border-blue-200 dark:border-blue-800",
    bar: "bg-blue-500",
  },
  purple: {
    badge: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300",
    header: "border-purple-200 dark:border-purple-800",
    bar: "bg-purple-500",
  },
  emerald: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300",
    header: "border-emerald-200 dark:border-emerald-800",
    bar: "bg-emerald-500",
  },
};

function ResultColumn({
  title,
  subtitle,
  icon,
  response,
  color,
  isFinal = false,
  query,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  response: SearchResponse | null;
  color: "blue" | "purple" | "emerald";
  isFinal?: boolean;
  query: string;
}) {
  const colors = colorMap[color];
  const resultCount = response?.results.length ?? 0;

  return (
    <Card className={isFinal ? "border-2 " + colors.header : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={colors.badge}>
              {icon}
              <span className="ml-1">{title}</span>
            </Badge>
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {resultCount}건
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {resultCount === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p className="mt-2 text-xs text-muted-foreground">
              검색 결과가 없습니다
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {response!.results.map((result, index) => (
              <ResultItem
                key={index}
                result={result}
                rank={index + 1}
                barColor={colors.bar}
                compact={!isFinal}
                query={query}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResultItem({
  result,
  rank,
  barColor,
  compact,
  query,
}: {
  result: SearchResult;
  rank: number;
  barColor: string;
  compact: boolean;
  query: string;
}) {
  const scorePercent = Math.round(result.score * 100);

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
      {/* Rank */}
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
        {rank}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {/* Title + Score */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <FileFormatIcon format={result.file_format} size="sm" />
            <Link
              href={`/documents/${result.document_id}`}
              className="truncate text-sm font-medium hover:text-primary hover:underline"
            >
              {highlightText(result.file_name, query)}
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
              <div
                className={"h-full rounded-full transition-all " + barColor}
                style={{ width: `${scorePercent}%` }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground w-8 text-right">
              {scorePercent}%
            </span>
          </div>
        </div>

        {/* Snippet (최종 결과에서만 표시) */}
        {!compact && result.snippet && (
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
            {highlightText(result.snippet, query)}
          </p>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="uppercase">{result.file_format}</span>
          <Separator orientation="vertical" className="h-3" />
          <span>{formatDate(result.rgst_dt)}</span>
        </div>
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ColumnSkeleton />
        <ColumnSkeleton />
      </div>
      <div className="flex justify-center">
        <Skeleton className="h-8 w-48 rounded-full" />
      </div>
      <ColumnSkeleton />
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-6 w-32" />
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
