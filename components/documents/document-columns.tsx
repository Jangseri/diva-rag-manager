"use client";

import { ColumnDef } from "@tanstack/react-table";
import type { DocumentResponse } from "@/types";
import { FileFormatIcon } from "./file-format-icon";
import { FileStatusBadge } from "./file-status-badge";
import { formatFileSize, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Eye, Download, Trash2 } from "lucide-react";
import Link from "next/link";

interface ColumnActions {
  onDownload: (doc: DocumentResponse) => void;
  onDelete: (doc: DocumentResponse) => void;
}

export function getColumns(actions: ColumnActions): ColumnDef<DocumentResponse>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              table.getIsSomePageRowsSelected()
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="전체 선택"
          />
        </div>
      ),
      cell: ({ row }) => {
        const doc = row.original;
        // DELETED 문서는 선택 불가
        if (doc.status === "DELETED") {
          return <div className="text-center text-muted-foreground/30">—</div>;
        }
        return (
          <div className="flex items-center justify-center">
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label={`${doc.file_name} 선택`}
            />
          </div>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: "file_name",
      header: () => <div className="text-center">파일명</div>,
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <div className="flex items-center gap-3">
            <FileFormatIcon format={doc.file_format} size="sm" />
            <Link
              href={`/documents/${doc.uuid}`}
              className="truncate font-medium text-foreground hover:text-primary hover:underline"
              title={doc.file_name}
            >
              {doc.file_name}
            </Link>
          </div>
        );
      },
    },
    {
      accessorKey: "file_format",
      header: () => <div className="text-center">형식</div>,
      cell: ({ row }) => (
        <div className="text-center text-xs font-medium uppercase text-muted-foreground">
          {row.original.file_format.toUpperCase()}
        </div>
      ),
    },
    {
      accessorKey: "file_status",
      header: () => <div className="text-center">상태</div>,
      cell: ({ row }) => (
        <div className="text-center">
          <FileStatusBadge status={row.original.file_status} />
        </div>
      ),
    },
    {
      accessorKey: "file_size",
      header: () => <div className="text-center">크기</div>,
      cell: ({ row }) => (
        <div className="text-center text-sm text-muted-foreground">
          {formatFileSize(row.original.file_size)}
        </div>
      ),
    },
    {
      accessorKey: "rgst_dt",
      header: () => <div className="text-center">등록일</div>,
      cell: ({ row }) => (
        <div className="text-center text-sm text-muted-foreground">
          {formatDate(row.original.rgst_dt)}
        </div>
      ),
    },
    {
      accessorKey: "user_key",
      header: () => <div className="text-center">등록자</div>,
      cell: ({ row }) => (
        <div className="text-center text-sm text-muted-foreground">
          {row.original.user_key}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <div className="text-center">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" className="h-8 w-8" />}
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  render={<Link href={`/documents/${doc.uuid}`} />}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  상세 보기
                </DropdownMenuItem>
                {doc.status !== "DELETED" && (
                  <>
                    <DropdownMenuItem onClick={() => actions.onDownload(doc)}>
                      <Download className="mr-2 h-4 w-4" />
                      다운로드
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => actions.onDelete(doc)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      삭제
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];
}
