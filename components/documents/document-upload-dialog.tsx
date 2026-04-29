"use client";

import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Upload, X, FileText, AlertCircle, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateFileFormat, validateFileSize } from "@/lib/validators/document";
import { validateAndNormalizeUrl } from "@/lib/validators/url";
import { formatFileSize } from "@/lib/format";
import { uploadDocuments, submitUrls } from "@/lib/api-client";
import { MAX_FILE_SIZE_MB } from "@/lib/constants";
import { toast } from "sonner";

const TOTAL_UPLOAD_LIMIT_BYTES = MAX_FILE_SIZE_MB * 10 * 1024 * 1024;
const MAX_URLS_PER_REQUEST = 50;

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface SelectedFile {
  file: File;
  error?: string;
}

interface ParsedUrl {
  raw: string;
  normalized?: string;
  error?: string;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  onSuccess,
}: UploadDialogProps) {
  const [tab, setTab] = useState<string>("file");

  // File tab state
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // URL tab state
  const [urlText, setUrlText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const busy = uploading || submitting;

  const validateAndAddFiles = useCallback((newFiles: FileList | File[]) => {
    const validated: SelectedFile[] = Array.from(newFiles).map((file) => {
      if (!validateFileFormat(file.name)) {
        return {
          file,
          error: "지원하지 않는 파일 형식이거나 파일명이 100자를 초과합니다",
        };
      }
      if (!validateFileSize(file.size)) {
        return { file, error: "파일 크기가 100MB를 초과합니다" };
      }
      return { file };
    });

    setFiles((prev) => [...prev, ...validated]);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) {
        validateAndAddFiles(e.dataTransfer.files);
      }
    },
    [validateAndAddFiles]
  );

  const handleUpload = async () => {
    const validFiles = files.filter((f) => !f.error).map((f) => f.file);
    if (validFiles.length === 0) return;

    setUploading(true);
    setProgress(0);

    try {
      const result = await uploadDocuments(validFiles, (percent) => {
        setProgress(percent);
      });
      setProgress(100);

      if (result.warnings && result.warnings.length > 0) {
        toast.warning(
          `${result.data.length}개 파일 업로드 완료 (${result.warnings.length}개 실패)`
        );
      } else {
        toast.success(`${result.data.length}개 파일이 업로드되었습니다`);
      }

      setTimeout(() => {
        resetAndClose();
      }, 500);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "업로드에 실패했습니다"
      );
      setUploading(false);
      setProgress(0);
    }
  };

  const handleUrlSubmit = async () => {
    const validUrls = parsedUrls
      .filter((p) => !p.error && p.normalized)
      .map((p) => p.normalized as string);

    if (validUrls.length === 0) return;

    setSubmitting(true);
    try {
      const result = await submitUrls({ urls: validUrls });

      if (result.warnings && result.warnings.length > 0) {
        toast.warning(
          `${result.data.length}개 URL 등록 완료 (${result.warnings.length}개 실패)`
        );
      } else {
        toast.success(`${result.data.length}개 URL이 등록되었습니다`);
      }

      resetAndClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "URL 등록에 실패했습니다"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setFiles([]);
    setProgress(0);
    setUploading(false);
    setUrlText("");
    setSubmitting(false);
    onOpenChange(false);
    onSuccess();
  };

  const validFiles = files.filter((f) => !f.error);
  const validFileCount = validFiles.length;
  const totalSize = validFiles.reduce((sum, f) => sum + f.file.size, 0);
  const exceedsTotal = totalSize > TOTAL_UPLOAD_LIMIT_BYTES;

  // URL parsing (memoized via input)
  const rawLines = urlText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const parsedUrls: ParsedUrl[] = rawLines.map((raw) => {
    const v = validateAndNormalizeUrl(raw);
    if (!v.valid) return { raw, error: v.error };
    return { raw, normalized: v.normalized };
  });
  const validUrlCount = parsedUrls.filter((p) => !p.error).length;
  const urlOverflow = parsedUrls.length > MAX_URLS_PER_REQUEST;
  const urlInvalidCount = parsedUrls.length - validUrlCount;

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>학습 자료 추가</DialogTitle>
          <DialogDescription>
            파일을 업로드하거나 웹 URL을 등록하여 학습할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => !busy && setTab(String(v))}>
          <TabsList className="w-full">
            <TabsTrigger value="file" className="flex-1">
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              파일
            </TabsTrigger>
            <TabsTrigger value="url" className="flex-1">
              <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
              URL
            </TabsTrigger>
          </TabsList>

          {/* === File Tab === */}
          <TabsContent value="file" className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              파일당 최대 100MB, 합계 최대 1GB까지. 파일명은 100자 이내.
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              )}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                파일을 드래그하거나 클릭하여 선택
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF, DOCX, PPTX, XLSX, HWP, HWPX, TXT, MD, JSON, JPG, PNG
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.pptx,.xlsx,.hwp,.hwpx,.txt,.md,.json,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) validateAndAddFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {files.map((item, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex items-center gap-3 rounded-md border px-3 py-2",
                        item.error
                          ? "border-destructive/50 bg-destructive/5"
                          : "border-border"
                      )}
                    >
                      {item.error ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{item.file.name}</p>
                        {item.error ? (
                          <p className="text-xs text-destructive">
                            {item.error}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(item.file.size)}
                          </p>
                        )}
                      </div>
                      {!uploading && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(index);
                          }}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {validFileCount > 0 && (
                  <div className="flex items-center justify-between px-1 text-xs">
                    <span className="text-muted-foreground">
                      합계{" "}
                      <span
                        className={cn(
                          "tabular-nums",
                          exceedsTotal && "font-medium text-destructive"
                        )}
                      >
                        {formatFileSize(totalSize)}
                      </span>{" "}
                      / {formatFileSize(TOTAL_UPLOAD_LIMIT_BYTES)}
                    </span>
                    {exceedsTotal && (
                      <span className="font-medium text-destructive">
                        총 용량 한도를 초과했습니다
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {uploading && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {progress < 100 ? "업로드 중..." : "처리 중..."}
                  </span>
                  <span className="font-medium tabular-nums">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}
          </TabsContent>

          {/* === URL Tab === */}
          <TabsContent value="url" className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              한 줄에 하나씩 URL을 입력하세요. 한 번에 최대 {MAX_URLS_PER_REQUEST}
              개까지 등록 가능합니다.
            </p>

            <Textarea
              placeholder={"https://example.com/article\nhttps://example.com/docs"}
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              rows={6}
              disabled={submitting}
              className="font-mono text-xs"
            />

            {parsedUrls.length > 0 && (
              <div className="space-y-2">
                <div className="max-h-44 space-y-1.5 overflow-y-auto">
                  {parsedUrls.map((p, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                        p.error
                          ? "border-destructive/50 bg-destructive/5"
                          : "border-border"
                      )}
                    >
                      {p.error ? (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      ) : (
                        <LinkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{p.raw}</p>
                        {p.error && (
                          <p className="mt-0.5 text-destructive">{p.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between px-1 text-xs">
                  <span className="text-muted-foreground tabular-nums">
                    유효 {validUrlCount}개
                    {urlInvalidCount > 0 && (
                      <span className="text-destructive">
                        {" "}
                        / 오류 {urlInvalidCount}개
                      </span>
                    )}
                  </span>
                  {urlOverflow && (
                    <span className="font-medium text-destructive">
                      한 번에 최대 {MAX_URLS_PER_REQUEST}개까지
                    </span>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            취소
          </Button>
          {tab === "file" ? (
            <Button
              onClick={handleUpload}
              disabled={validFileCount === 0 || uploading || exceedsTotal}
            >
              {uploading ? "업로드 중..." : `업로드 (${validFileCount}개)`}
            </Button>
          ) : (
            <Button
              onClick={handleUrlSubmit}
              disabled={validUrlCount === 0 || submitting || urlOverflow}
            >
              {submitting ? "등록 중..." : `등록 (${validUrlCount}개)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
