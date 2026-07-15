import type {
  CreateShareInput,
  DownloadGrant,
  PublicShareInfo,
  ShareInfo,
  UpdateShareInput,
} from '../types/share'
import { ApiError, requestJson } from '../utils/request'

interface ApiResult<T> {
  success: boolean
  data: T
  message?: string
}

export async function createShare(input: CreateShareInput): Promise<ShareInfo> {
  const result = await requestJson<ApiResult<ShareInfo>>('/api/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return result.data
}

export async function listShares(): Promise<ShareInfo[]> {
  const result = await requestJson<ApiResult<ShareInfo[]>>('/api/shares')
  return result.data
}

export async function updateShare(id: string, input: UpdateShareInput): Promise<ShareInfo> {
  const result = await requestJson<ApiResult<ShareInfo>>(`/api/shares/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return result.data
}

export async function deleteShare(id: string): Promise<void> {
  await requestJson(`/api/shares/${id}`, { method: 'DELETE' })
}

export async function getPublicShare(id: string): Promise<PublicShareInfo> {
  const result = await publicRequestJson<ApiResult<PublicShareInfo>>(
    `/api/shares/public/${encodeURIComponent(id)}`,
  )
  return result.data
}

export async function authorizeShareDownload(
  id: string,
  password?: string,
): Promise<DownloadGrant> {
  const result = await publicRequestJson<ApiResult<DownloadGrant>>(
    `/api/shares/public/${encodeURIComponent(id)}/authorize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
  )
  return result.data
}

async function publicRequestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options)
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '')
  if (!response.ok || body?.success === false) {
    const message = Array.isArray(body?.message)
      ? body.message.join('；')
      : body?.message || `请求失败（HTTP ${response.status}）`
    throw new ApiError(message, response.status)
  }
  return body as T
}
