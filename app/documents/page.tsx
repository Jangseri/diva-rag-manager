"use client";

import { useState, useEffect, useCallback } from "react";
import { DocumentTable } from "@/components/documents/document-table";
import { DocumentToolbar } from "@/components/documents/document-toolbar";
import { DocumentPagination } from "@/components/documents/document-pagination";
import { DocumentUploadDialog } from "@/components/documents/document-upload-dialog";
import { DocumentDeleteDialog } from "@/components/documents/document-delete-dialog";
import {
  fetchDocuments,
  deleteDocument,
  deleteDocumentsBulk,
  getDownloadUrl,
} from "@/lib/api-client";
import type { DocumentResponse, DocumentListResponse } from "@/types";
import type { RowSelectionState } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Trash2, X } from "lucide-react";
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

export default function DocumentsPage() {
  const [data, setData] = useState<DocumentListResponse>({
    data: [],
    total: 0,
    page: 1,
    size: 10,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("ALL");
  const [fileStatus, setFileStatus] = useState("ALL");
  const [docStatus, setDocStatus] = useState("ACTIVE");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  // Dialog states
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentResponse | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Bulk selection
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const selectedCount = selectedIds.length;

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchDocuments({
        page,
        size,
        search: search || undefined,
        format: format === "ALL" ? undefined : format,
        status: docStatus,
        file_status: fileStatus === "ALL" ? undefined : fileStatus,
        sort: "rgst_dt",
        order: "desc",
      });
      setData(result);
    } catch (error) {
      toast.error("문서 목록을 불러오는데 실패했습니다");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [page, size, search, format, fileStatus, docStatus]);

  useEffect(() => {
    loadDocuments();
    setRowSelection({});
  }, [loadDocuments]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleDownload = (doc: DocumentResponse) => {
    window.open(getDownloadUrl(doc.file_id), "_blank");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteDocument(deleteTarget.file_id);
      toast.success(`"${deleteTarget.file_name}" 파일이 삭제되었습니다`);
      setDeleteTarget(null);
      loadDocuments();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "삭제에 실패했습니다"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      const result = await deleteDocumentsBulk(selectedIds);
      if (result.failed.length === 0) {
        toast.success(`${result.success.length}개 문서가 삭제되었습니다`);
      } else {
        toast.warning(
          `${result.success.length}개 성공, ${result.failed.length}개 실패`
        );
      }
      setRowSelection({});
      setBulkDeleteOpen(false);
      loadDocuments();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "일괄 삭제에 실패했습니다"
      );
    } finally {
      setIsBulkDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">문서 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          RAG 시스템에 사용할 문서를 관리합니다.
        </p>
      </div>

      {/* Toolbar */}
      <DocumentToolbar
        search={search}
        onSearchChange={setSearch}
        format={format}
        onFormatChange={(v) => {
          setFormat(v);
          setPage(1);
        }}
        fileStatus={fileStatus}
        onFileStatusChange={(v) => {
          setFileStatus(v);
          setPage(1);
        }}
        docStatus={docStatus}
        onDocStatusChange={(v) => {
          setDocStatus(v);
          setPage(1);
        }}
        onUploadClick={() => setUploadOpen(true)}
      />

      {/* Bulk Action Bar */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              <span className="text-primary">{selectedCount}</span>개 선택됨
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setRowSelection({})}
            >
              <X className="h-3.5 w-3.5" />
              선택 해제
            </Button>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            선택 삭제
          </Button>
        </div>
      )}

      {/* Table */}
      <DocumentTable
        data={data.data}
        isLoading={isLoading}
        onDownload={handleDownload}
        onDelete={setDeleteTarget}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
      />

      {/* Pagination */}
      <DocumentPagination
        page={page}
        size={size}
        total={data.total}
        onPageChange={setPage}
        onSizeChange={(newSize) => {
          setSize(newSize);
          setPage(1);
        }}
      />

      {/* Dialogs */}
      <DocumentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={loadDocuments}
      />

      <DocumentDeleteDialog
        document={deleteTarget}
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />

      {/* Bulk Delete Confirm */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              선택한 {selectedCount}개 문서를 삭제하시겠습니까?
            </AlertDialogTitle>
            <AlertDialogDescription>
              삭제된 문서는 목록에서 제외되며, 복구는 관리자에게 문의해야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting ? "삭제 중..." : `${selectedCount}개 삭제`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
