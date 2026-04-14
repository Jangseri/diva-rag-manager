import { NextResponse } from "next/server";
import type { DocumentRecord, DocumentResponse } from "@/types";

export function toDocumentResponse(doc: DocumentRecord): DocumentResponse {
  return {
    uuid: doc.uuid,
    file_name: doc.file_name,
    user_key: doc.user_key,
    file_format: doc.file_format,
    file_status: doc.file_status,
    file_size: doc.file_size.toString(),
    rgst_dt: doc.rgst_dt.toISOString(),
    rgst_nm: doc.rgst_nm,
    status: doc.status,
    updt_dt: doc.updt_dt.toISOString(),
    updt_nm: doc.updt_nm,
  };
}

export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function validationErrorResponse(
  message: string,
  details?: Record<string, string[]>
) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}
