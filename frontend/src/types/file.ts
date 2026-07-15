export interface FileInfo {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export type FileSortBy = "name" | "size" | "modifiedAt" | "type";
export type FileSortOrder = "asc" | "desc";

export interface FileListQuery {
  path: string;
  page: number;
  pageSize: number;
  keyword?: string;
  sortBy?: FileSortBy;
  sortOrder?: FileSortOrder;
}

export interface FilePagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BatchOperationItem {
  path: string;
  success: boolean;
  targetPath?: string;
  message?: string;
}

export interface BatchOperationResult {
  succeeded: number;
  failed: number;
  items: BatchOperationItem[];
}

export type PreviewKind =
  | "image"
  | "text"
  | "pdf"
  | "audio"
  | "video"
  | "unsupported";

export interface PreviewDescriptor {
  token: string;
  url: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  kind: PreviewKind;
  expiresAt: string;
}

export interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  isDirectory: boolean;
  size: number;
  deletedAt: string;
}

export interface RecentFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface DashboardStats {
  totalFiles: number;
  totalFolders: number;
  totalBytes: number;
  storageLimitBytes: number;
  activeShares: number;
  totalShares: number;
  recentFiles: RecentFile[];
}

export interface UploadResultFile {
  name: string;
  path: string;
}

interface UploadSessionBase {
  uploadedChunks: number[];
  expiresAt: string;
  contentHash?: string;
}

export interface ChunkedUploadSession extends UploadSessionBase {
  instantUpload: false;
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  file?: never;
}

export interface InstantUploadSession extends UploadSessionBase {
  instantUpload: true;
  contentHash: string;
  file: UploadResultFile;
  uploadId?: never;
  chunkSize?: never;
  totalChunks?: never;
}

export type UploadSession = ChunkedUploadSession | InstantUploadSession;

export type UploadStatus =
  | "queued"
  | "hashing"
  | "initializing"
  | "uploading"
  | "paused"
  | "completing"
  | "success"
  | "error"
  | "cancelled";

export interface UploadTask {
  id: string;
  fileName: string;
  fileSize: number;
  targetPath: string;
  status: UploadStatus;
  progress: number;
  uploadedBytes: number;
  speed: number;
  uploadId?: string;
  chunkSize?: number;
  totalChunks?: number;
  uploadedChunks: number[];
  error?: string;
  resultName?: string;
  contentHash?: string;
  instantUpload?: boolean;
  createdAt: number;
}
