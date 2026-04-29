"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DocumentResponse } from "@/types";

interface DeleteDialogProps {
  document: DocumentResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting?: boolean;
}

export function DocumentDeleteDialog({
  document,
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: DeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>문서를 삭제하시겠습니까?</AlertDialogTitle>
          <AlertDialogDescription>
            삭제된 문서는 목록에서 제외되며, 복구는 관리자에게 문의해야 합니다.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {document && (
          <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <p
              className="line-clamp-2 break-all font-medium text-foreground"
              title={document.file_name}
            >
              {document.file_name}
            </p>
            {document.source_type === "url" && document.source_url && (
              <p
                className="line-clamp-1 break-all text-xs text-muted-foreground"
                title={document.source_url}
              >
                {document.source_url}
              </p>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "삭제 중..." : "삭제"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
