"use client";

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type RowSelectionState,
} from "@tanstack/react-table";
import type { DocumentResponse } from "@/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getColumns } from "./document-columns";
import { Skeleton } from "@/components/ui/skeleton";
import { FileX } from "lucide-react";

interface DocumentTableProps {
  data: DocumentResponse[];
  isLoading?: boolean;
  onDownload: (doc: DocumentResponse) => void;
  onDelete: (doc: DocumentResponse) => void;
  rowSelection: RowSelectionState;
  onRowSelectionChange: (state: RowSelectionState) => void;
}

export function DocumentTable({
  data,
  isLoading,
  onDownload,
  onDelete,
  rowSelection,
  onRowSelectionChange,
}: DocumentTableProps) {
  const columns = getColumns({ onDownload, onDelete });

  const table = useReactTable({
    data,
    columns,
    state: { rowSelection },
    enableRowSelection: (row) => row.original.status !== "DELETED",
    onRowSelectionChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater;
      onRowSelectionChange(next);
    },
    getRowId: (row) => row.file_id,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading) {
    return <TableSkeleton />;
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="h-11 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="group">
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <EmptyState />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <FileX className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">
        등록된 문서가 없습니다
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground">
        파일을 업로드하여 문서를 등록해보세요.
      </p>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="p-4 space-y-3">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
