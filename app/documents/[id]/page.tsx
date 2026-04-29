"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import {
  fetchDocument,
  deleteDocument,
  getDownloadUrl,
  fetchPreview,
  type PreviewResponse,
} from "@/lib/api-client";
import type { DocumentResponse } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { FileFormatIcon } from "@/components/documents/file-format-icon";
import { FileStatusBadge } from "@/components/documents/file-status-badge";
import { DocumentDeleteDialog } from "@/components/documents/document-delete-dialog";
import { formatFileSize, formatDateTime } from "@/lib/format";
import {
  ArrowLeft,
  Download,
  Trash2,
  Calendar,
  User,
  HardDrive,
  FileType,
  Eye,
  AlertCircle,
  Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [document, setDocument] = useState<DocumentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await fetchDocument(id);
        if (cancelled) return;
        setDocument(result.data);

        // 미리보기 시도 (ACTIVE 상태이며 파일 케이스만)
        if (
          result.data.status === "ACTIVE" &&
          result.data.source_type !== "url"
        ) {
          setPreviewLoading(true);
          try {
            const p = await fetchPreview(id);
            if (!cancelled) setPreview(p);
          } catch {
            // 미리보기 실패는 무시 (기능 실패가 아님)
          } finally {
            if (!cancelled) setPreviewLoading(false);
          }
        }
      } catch {
        if (!cancelled) {
          toast.error("문서를 찾을 수 없습니다");
          router.push("/documents");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const handleDelete = async () => {
    if (!document) return;
    setIsDeleting(true);
    try {
      await deleteDocument(document.file_id);
      toast.success("문서가 삭제되었습니다");
      router.push("/documents");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "삭제에 실패했습니다"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!document) return null;

  const isUrl = document.source_type === "url";
  const iconFormat = isUrl ? "url" : document.file_format;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Back Button */}
      <Button
        variant="ghost"
        className="gap-2 pl-1 text-muted-foreground hover:text-foreground"
        onClick={() => router.push("/documents")}
      >
        <ArrowLeft className="h-4 w-4" />
        목록으로
      </Button>

      <Card>
        {/* Header: 파일명 + 뱃지 + 액션 */}
        <div className="px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="shrink-0 pt-0.5">
                <FileFormatIcon format={iconFormat} size="lg" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1
                    className="truncate text-lg font-semibold"
                    title={document.file_name}
                  >
                    {document.file_name}
                  </h1>
                  <div className="shrink-0">
                    <FileStatusBadge status={document.file_status} />
                  </div>
                  {document.status === "DELETED" && (
                    <span className="shrink-0 rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-destructive dark:bg-red-950">
                      DELETED
                    </span>
                  )}
                </div>
                {isUrl && document.source_url && (
                  <a
                    href={document.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={document.source_url}
                    className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    {document.source_url}
                  </a>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {!isUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    window.open(getDownloadUrl(document.file_id), "_blank")
                  }
                  disabled={document.status === "DELETED"}
                >
                  <Download className="h-4 w-4" />
                  다운로드
                </Button>
              )}
              {isUrl && document.source_url && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    window.open(document.source_url!, "_blank", "noopener")
                  }
                >
                  <LinkIcon className="h-4 w-4" />
                  원본 열기
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => setDeleteOpen(true)}
                disabled={document.status === "DELETED"}
              >
                <Trash2 className="h-4 w-4" />
                삭제
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* 메타데이터 */}
        <CardContent className="px-6 py-5">
          <div className="grid grid-cols-3 gap-x-8 gap-y-5">
            <MetadataItem
              icon={User}
              label="등록자"
              value={document.user_key}
            />
            <MetadataItem
              icon={FileType}
              label="형식"
              value={isUrl ? "URL" : (document.file_format ?? "—").toUpperCase()}
            />
            {!isUrl && (
              <MetadataItem
                icon={HardDrive}
                label="파일 크기"
                value={formatFileSize(document.file_size)}
              />
            )}
            <MetadataItem
              icon={Calendar}
              label="등록일시"
              value={formatDateTime(document.rgst_dt)}
            />
            <MetadataItem
              icon={Calendar}
              label="수정일시"
              value={formatDateTime(document.updt_dt)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Preview (파일 케이스만) */}
      {!isUrl &&
        document.status !== "DELETED" &&
        document.status !== "DELETING" && (
          <PreviewCard preview={preview} loading={previewLoading} />
        )}

      {/* Delete Dialog */}
      <DocumentDeleteDialog
        document={document}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}

function PreviewCard({
  preview,
  loading,
}: {
  preview: PreviewResponse | null;
  loading: boolean;
}) {
  const [tab, setTab] = useState<"original" | "extracted">("extracted");
  const section = preview ? preview[tab] : null;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <Eye className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">미리보기</h2>

        <div className="ml-4 flex gap-1">
          <button
            onClick={() => setTab("extracted")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === "extracted"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            추출 텍스트
          </button>
          <button
            onClick={() => setTab("original")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === "original"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            원본 (JSON)
          </button>
        </div>

        {section?.truncated && (
          <span className="ml-auto text-xs text-muted-foreground">
            일부만 표시 (500KB 한도)
          </span>
        )}
      </div>

      <CardContent className="px-6 py-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : !section?.previewable ? (
          <div className="flex items-start gap-2 rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {section?.reason || "미리보기를 사용할 수 없습니다"}
            </span>
          </div>
        ) : (
          <pre className="max-h-96 overflow-auto rounded-md bg-muted/40 p-4 text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground font-mono">
            {section.content}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function MetadataItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Skeleton className="h-8 w-24" />
      <Card>
        <div className="px-6 py-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <Separator />
        <CardContent className="px-6 py-5">
          <div className="grid grid-cols-3 gap-x-8 gap-y-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
