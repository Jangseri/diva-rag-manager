"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Upload, X } from "lucide-react";

interface DocumentToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  format: string;
  onFormatChange: (value: string) => void;
  fileStatus: string;
  onFileStatusChange: (value: string) => void;
  docStatus: string;
  onDocStatusChange: (value: string) => void;
  onUploadClick: () => void;
}

export function DocumentToolbar({
  search,
  onSearchChange,
  format,
  onFormatChange,
  fileStatus,
  onFileStatusChange,
  docStatus,
  onDocStatusChange,
  onUploadClick,
}: DocumentToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-3">
        {/* Search */}
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="파일명 검색..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Format Filter */}
        <Select value={format} onValueChange={(v) => onFormatChange(v ?? "ALL")}>
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue placeholder="형식" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ALL</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="docx">DOCX</SelectItem>
            <SelectItem value="txt">TXT</SelectItem>
            <SelectItem value="hwp">HWP</SelectItem>
            <SelectItem value="xlsx">XLSX</SelectItem>
            <SelectItem value="pptx">PPTX</SelectItem>
          </SelectContent>
        </Select>

        {/* File Status Filter (파일 처리 상태) */}
        <Select value={fileStatus} onValueChange={(v) => onFileStatusChange(v ?? "ALL")}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="파일 상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ALL</SelectItem>
            <SelectItem value="UPLOADED">UPLOADED</SelectItem>
            <SelectItem value="PROCESSING">PROCESSING</SelectItem>
            <SelectItem value="EXTRACTED">EXTRACTED</SelectItem>
            <SelectItem value="INDEXED">INDEXED</SelectItem>
            <SelectItem value="FAILED">FAILED</SelectItem>
            <SelectItem value="INDEX_FAILED">INDEX_FAILED</SelectItem>
          </SelectContent>
        </Select>

        {/* Doc Status Filter (문서 관리 상태) */}
        <Select value={docStatus} onValueChange={(v) => onDocStatusChange(v ?? "ACTIVE")}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="문서 상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">ACTIVE</SelectItem>
            <SelectItem value="DELETING">DELETING</SelectItem>
            <SelectItem value="DELETED">DELETED</SelectItem>
            <SelectItem value="DELETE_PARTIAL_FAILURE">DELETE_PARTIAL_FAILURE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Upload Button */}
      <Button onClick={onUploadClick} className="h-9 gap-2">
        <Upload className="h-4 w-4" />
        파일 업로드
      </Button>
    </div>
  );
}
