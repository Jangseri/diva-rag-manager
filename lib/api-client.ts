import type {
  DocumentListResponse,
  DocumentResponse,
  SearchResponse,
  SearchMethod,
} from "@/types";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "요청에 실패했습니다" }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function fetchDocuments(params: {
  page?: number;
  size?: number;
  sort?: string;
  order?: string;
  search?: string;
  format?: string;
  status?: string;
  file_status?: string;
}): Promise<DocumentListResponse> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  return fetchApi<DocumentListResponse>(`/api/documents?${searchParams}`);
}

export async function fetchDocument(
  id: string
): Promise<{ data: DocumentResponse }> {
  return fetchApi(`/api/documents/${id}`);
}

export async function uploadDocuments(
  files: File[],
  onProgress?: (percent: number) => void
): Promise<{ data: DocumentResponse[]; warnings?: string[] }> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body);
        } else {
          reject(new Error(body.error || `HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error("응답 파싱 실패"));
      }
    };

    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.onabort = () => reject(new Error("업로드가 취소되었습니다"));

    xhr.send(formData);
  });
}

export async function deleteDocument(
  id: string
): Promise<{ success: boolean; data: DocumentResponse }> {
  return fetchApi(`/api/documents/${id}`, {
    method: "DELETE",
  });
}

export async function deleteDocumentsBulk(
  ids: string[]
): Promise<{ success: string[]; failed: { file_id: string; error: string }[] }> {
  return fetchApi(`/api/documents/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

export function getDownloadUrl(id: string): string {
  return `/api/documents/${id}/download`;
}

export interface PreviewResponse {
  previewable: boolean;
  content?: string;
  truncated?: boolean;
  size?: number;
  reason?: string;
}

export async function fetchPreview(id: string): Promise<PreviewResponse> {
  return fetchApi(`/api/documents/${id}/preview`);
}

export async function searchDocuments(params: {
  query: string;
  method: SearchMethod;
  top_k?: number;
}): Promise<SearchResponse> {
  return fetchApi("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}
