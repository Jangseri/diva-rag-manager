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

interface UrlChip {
  id: string;
  raw: string;
  normalized?: string;
  error?: string;
}

let chipIdCounter = 0;
const nextChipId = () => `chip-${Date.now()}-${++chipIdCounter}`;

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
  const [chips, setChips] = useState<UrlChip[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = async () => {
    // 입력 중인 텍스트가 있으면 먼저 칩으로 변환
    let pendingChips = chips;
    if (currentInput.trim()) {
      addChipsFromText(currentInput);
      setCurrentInput("");
      // setState 비동기 → 직접 계산해서 사용
      const tokens = currentInput
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const existing = new Set(
        chips.filter((c) => c.normalized).map((c) => c.normalized!)
      );
      const newOnes: UrlChip[] = tokens.map((raw) => {
        const v = validateAndNormalizeUrl(raw);
        if (!v.valid) return { id: nextChipId(), raw, error: v.error };
        if (existing.has(v.normalized!)) {
          return { id: nextChipId(), raw, error: "이미 추가된 URL입니다" };
        }
        existing.add(v.normalized!);
        return { id: nextChipId(), raw, normalized: v.normalized };
      });
      pendingChips = [...chips, ...newOnes];
    }

    const validFilesList = files.filter((f) => !f.error).map((f) => f.file);
    const validUrlList = pendingChips
      .filter((c) => !c.error && c.normalized)
      .map((c) => c.normalized as string);

    if (validFilesList.length === 0 && validUrlList.length === 0) return;

    let fileSuccess = 0;
    let fileFail = 0;
    let urlSuccess = 0;
    let urlFail = 0;
    let fatalError: string | null = null;

    // 1. 파일 업로드 (있으면)
    if (validFilesList.length > 0) {
      setUploading(true);
      setProgress(0);
      try {
        const result = await uploadDocuments(validFilesList, setProgress);
        setProgress(100);
        fileSuccess = result.data.length;
        fileFail = result.warnings?.length ?? 0;
      } catch (error) {
        fatalError =
          error instanceof Error ? error.message : "파일 업로드 실패";
      } finally {
        setUploading(false);
      }
    }

    // 파일에서 치명적 실패면 URL 등록 진행하지 않음
    if (fatalError) {
      toast.error(fatalError);
      setProgress(0);
      return;
    }

    // 2. URL 등록 (있으면)
    if (validUrlList.length > 0) {
      setSubmitting(true);
      try {
        const result = await submitUrls({ urls: validUrlList });
        urlSuccess = result.data.length;
        urlFail = result.warnings?.length ?? 0;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "URL 등록 실패";
        // 파일은 이미 등록됐을 수 있음 → 부분 결과 토스트 후 종료
        if (fileSuccess > 0) {
          toast.warning(
            `파일 ${fileSuccess}개 등록 완료, URL 등록 실패: ${msg}`
          );
          setTimeout(() => resetAndClose(), 800);
        } else {
          toast.error(msg);
        }
        setSubmitting(false);
        return;
      } finally {
        setSubmitting(false);
      }
    }

    // 통합 결과 토스트
    const totalSuccess = fileSuccess + urlSuccess;
    const totalFail = fileFail + urlFail;
    if (totalFail > 0) {
      toast.warning(`${totalSuccess}개 등록 완료 (${totalFail}개 실패)`);
    } else {
      toast.success(`${totalSuccess}개가 등록되었습니다`);
    }

    setTimeout(() => resetAndClose(), 500);
  };

  const addChipsFromText = useCallback(
    (rawText: string) => {
      const tokens = rawText
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (tokens.length === 0) return;

      setChips((prev) => {
        const existing = new Set(
          prev.filter((c) => c.normalized).map((c) => c.normalized!)
        );
        const next: UrlChip[] = tokens.map((raw) => {
          const v = validateAndNormalizeUrl(raw);
          if (!v.valid) {
            return { id: nextChipId(), raw, error: v.error };
          }
          if (existing.has(v.normalized!)) {
            return { id: nextChipId(), raw, error: "이미 추가된 URL입니다" };
          }
          existing.add(v.normalized!);
          return { id: nextChipId(), raw, normalized: v.normalized };
        });
        return [...prev, ...next];
      });
    },
    []
  );

  const commitCurrentInput = () => {
    if (currentInput.trim()) {
      addChipsFromText(currentInput);
      setCurrentInput("");
    }
  };

  const handleUrlInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (currentInput.trim()) {
        e.preventDefault();
        commitCurrentInput();
      }
    } else if (e.key === "Backspace" && !currentInput && chips.length > 0) {
      setChips((prev) => prev.slice(0, -1));
    }
  };

  const handleUrlInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/[\s,;]/.test(text)) {
      e.preventDefault();
      addChipsFromText(currentInput + text);
      setCurrentInput("");
    }
  };

  const removeChip = (id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  };

  const resetAndClose = () => {
    setFiles([]);
    setProgress(0);
    setUploading(false);
    setChips([]);
    setCurrentInput("");
    setSubmitting(false);
    onOpenChange(false);
    onSuccess();
  };

  const validFiles = files.filter((f) => !f.error);
  const validFileCount = validFiles.length;
  const totalSize = validFiles.reduce((sum, f) => sum + f.file.size, 0);
  const exceedsTotal = totalSize > TOTAL_UPLOAD_LIMIT_BYTES;

  const validUrlCount = chips.filter((c) => !c.error).length;
  const urlInvalidCount = chips.length - validUrlCount;
  const urlOverflow = chips.length > MAX_URLS_PER_REQUEST;

  const getSubmitLabel = () => {
    if (uploading) return progress < 100 ? "업로드 중..." : "처리 중...";
    if (submitting) return "URL 등록 중...";
    const parts: string[] = [];
    if (validFileCount > 0) parts.push(`파일 ${validFileCount}개`);
    if (validUrlCount > 0) parts.push(`URL ${validUrlCount}개`);
    if (parts.length === 0) return "등록";
    return `등록 (${parts.join(" · ")})`;
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>학습 자료 추가</DialogTitle>
          <DialogDescription>
            파일을 업로드하거나 웹 URL을 등록하여 학습할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => !busy && setTab(String(v))}
          className="w-full min-w-0"
        >
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

          </TabsContent>

          {/* === URL Tab === */}
          <TabsContent
            value="url"
            className="mt-4 min-w-0 space-y-3 overflow-hidden"
          >
            <p className="text-xs text-muted-foreground">
              URL 입력 후 <kbd className="rounded border px-1 text-[10px]">Enter</kbd>{" "}
              <kbd className="rounded border px-1 text-[10px]">,</kbd>{" "}
              <kbd className="rounded border px-1 text-[10px]">공백</kbd>으로 추가.
              여러 URL은 한 번에 붙여넣기도 가능합니다 (최대{" "}
              {MAX_URLS_PER_REQUEST}개).
            </p>

            <div
              onClick={() => urlInputRef.current?.focus()}
              className={cn(
                "flex min-h-[6rem] max-h-60 w-full max-w-full flex-wrap items-start gap-1.5 overflow-y-auto rounded-lg border border-input bg-transparent p-2 transition-colors",
                "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
                submitting && "cursor-not-allowed bg-input/50 opacity-50"
              )}
            >
              {chips.map((chip) => (
                <span
                  key={chip.id}
                  title={chip.error ? `${chip.raw} — ${chip.error}` : chip.raw}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                    chip.error
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-primary/30 bg-primary/10 text-primary"
                  )}
                >
                  {chip.error ? (
                    <AlertCircle className="h-3 w-3 shrink-0" />
                  ) : (
                    <LinkIcon className="h-3 w-3 shrink-0" />
                  )}
                  <span className="max-w-[20rem] truncate">{chip.raw}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeChip(chip.id);
                    }}
                    disabled={submitting}
                    className="shrink-0 rounded-sm hover:opacity-60 disabled:opacity-30"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                ref={urlInputRef}
                type="text"
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                onKeyDown={handleUrlInputKeyDown}
                onPaste={handleUrlInputPaste}
                onBlur={commitCurrentInput}
                disabled={submitting}
                placeholder={
                  chips.length === 0
                    ? "https://example.com/..."
                    : ""
                }
                className="min-w-[10rem] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
            </div>

            {(chips.length > 0 || urlOverflow) && (
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
            )}
          </TabsContent>
        </Tabs>

        {(uploading || (submitting && progress === 100)) && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {uploading
                  ? progress < 100
                    ? "파일 업로드 중..."
                    : "파일 처리 중..."
                  : "URL 등록 중..."}
              </span>
              {uploading && (
                <span className="font-medium tabular-nums">{progress}%</span>
              )}
            </div>
            {uploading && <Progress value={progress} className="h-2" />}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              (validFileCount === 0 && validUrlCount === 0) ||
              busy ||
              exceedsTotal ||
              urlOverflow
            }
          >
            {getSubmitLabel()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
