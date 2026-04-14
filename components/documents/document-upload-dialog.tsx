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
import { Upload, X, FileText, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateFileFormat, validateFileSize } from "@/lib/validators/document";
import { formatFileSize } from "@/lib/format";
import { uploadDocuments } from "@/lib/api-client";
import { toast } from "sonner";

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface SelectedFile {
  file: File;
  error?: string;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  onSuccess,
}: UploadDialogProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = useCallback((newFiles: FileList | File[]) => {
    const validated: SelectedFile[] = Array.from(newFiles).map((file) => {
      if (!validateFileFormat(file.name)) {
        return {
          file,
          error: "지원하지 않는 파일 형식입니다",
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
        setFiles([]);
        setProgress(0);
        setUploading(false);
        onOpenChange(false);
        onSuccess();
      }, 500);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "업로드에 실패했습니다"
      );
      setUploading(false);
      setProgress(0);
    }
  };

  const validFileCount = files.filter((f) => !f.error).length;

  return (
    <Dialog open={open} onOpenChange={uploading ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>파일 업로드</DialogTitle>
          <DialogDescription>
            PDF, DOCX, TXT, HWP, XLSX, PPTX 파일을 업로드할 수 있습니다. (최대
            100MB)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop Zone */}
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
              PDF, DOCX, TXT, HWP, XLSX, PPTX
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.hwp,.xlsx,.pptx"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) validateAndAddFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {files.map((item, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2",
                    item.error ? "border-destructive/50 bg-destructive/5" : "border-border"
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
                      <p className="text-xs text-destructive">{item.error}</p>
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
          )}

          {/* Progress */}
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
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            취소
          </Button>
          <Button
            onClick={handleUpload}
            disabled={validFileCount === 0 || uploading}
          >
            {uploading ? "업로드 중..." : `업로드 (${validFileCount}개)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
