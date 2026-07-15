import type {
  BatchOperationResult,
  DashboardStats,
  FileInfo,
  FileListQuery,
  FilePagination,
  FileSortOrder,
  PreviewDescriptor,
  TrashItem,
  UploadSession,
} from "../types/file";
import { request, requestJson } from "../utils/request";

interface ApiResult<T> {
  success: boolean;
  data: T;
  message?: string;
}

export async function listFiles(
  query: FileListQuery,
): Promise<{ path: string; files: FileInfo[]; pagination: FilePagination }> {
  const params = new URLSearchParams({
    path: query.path,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.keyword) params.set("keyword", query.keyword);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);

  const result = await requestJson<
    ApiResult<FileInfo[]> & { path: string; pagination: FilePagination }
  >(`/api/files/list?${params.toString()}`);
  return {
    path: result.path,
    files: result.data,
    pagination: result.pagination,
  };
}

export async function createFolder(path: string, name: string): Promise<void> {
  await requestJson("/api/files/mkdir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name }),
  });
}

export async function renameFile(path: string, newName: string): Promise<void> {
  await requestJson("/api/files/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, newName }),
  });
}

export async function deleteFile(path: string): Promise<void> {
  await requestJson("/api/files", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export async function deleteFiles(
  paths: string[],
): Promise<BatchOperationResult> {
  const result = await requestJson<ApiResult<BatchOperationResult>>(
    "/api/files/batch/delete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    },
  );
  return result.data;
}

export async function createPreviewToken(
  path: string,
): Promise<PreviewDescriptor> {
  const result = await requestJson<ApiResult<PreviewDescriptor>>(
    "/api/files/preview-token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    },
  );
  return result.data;
}

export async function listTrash(query: {
  page: number;
  pageSize: number;
  keyword?: string;
  sortBy?: "name" | "size" | "deletedAt";
  sortOrder?: FileSortOrder;
}): Promise<{ items: TrashItem[]; pagination: FilePagination }> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.keyword) params.set("keyword", query.keyword);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const result = await requestJson<
    ApiResult<TrashItem[]> & { pagination: FilePagination }
  >(`/api/trash?${params.toString()}`);
  return { items: result.data, pagination: result.pagination };
}

export async function restoreTrashItem(
  id: string,
): Promise<{ name: string; path: string }> {
  const result = await requestJson<ApiResult<{ name: string; path: string }>>(
    `/api/trash/${id}/restore`,
    { method: "POST" },
  );
  return result.data;
}

export async function permanentlyDeleteTrashItem(id: string): Promise<void> {
  await requestJson(`/api/trash/${id}`, { method: "DELETE" });
}

export async function emptyTrash(): Promise<number> {
  const result = await requestJson<ApiResult<{ deleted: number }>>(
    "/api/trash",
    {
      method: "DELETE",
    },
  );
  return result.data.deleted;
}

export async function moveFiles(
  paths: string[],
  targetPath: string,
): Promise<BatchOperationResult> {
  const result = await requestJson<ApiResult<BatchOperationResult>>(
    "/api/files/batch/move",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, targetPath }),
    },
  );
  return result.data;
}

export async function downloadFile(
  path: string,
  fileName: string,
): Promise<void> {
  const response = await request(
    `/api/files/download?path=${encodeURIComponent(path)}`,
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || "下载失败");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function initializeUpload(input: {
  path: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  resumeId?: string;
  contentHash?: string;
}): Promise<UploadSession> {
  const result = await requestJson<ApiResult<UploadSession>>(
    "/api/files/uploads/init",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.data;
}

export async function completeUpload(
  uploadId: string,
): Promise<{ name: string; path: string; contentHash: string }> {
  const result = await requestJson<
    ApiResult<{ name: string; path: string; contentHash: string }>
  >(`/api/files/uploads/${uploadId}/complete`, { method: "POST" });
  return result.data;
}

export async function cancelUpload(uploadId: string): Promise<void> {
  await requestJson(`/api/files/uploads/${uploadId}`, { method: "DELETE" });
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const result = await requestJson<ApiResult<DashboardStats>>("/api/stats");
  return result.data;
}
