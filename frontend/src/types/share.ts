export type ShareStatus = 'active' | 'disabled' | 'expired' | 'limit_reached'

export interface ShareLogInfo {
  id: number
  ip: string
  userAgent: string | null
  accessedAt: string
}

export interface ShareInfo {
  id: string
  name: string
  path: string
  createdAt: string
  expiresAt: string
  isEnabled: boolean
  hasPassword: boolean
  maxDownloads: number | null
  downloadCount: number
  remainingDownloads: number | null
  status: ShareStatus
  logs: ShareLogInfo[]
}

export interface PublicShareInfo {
  id: string
  name: string
  createdAt: string
  expiresAt: string
  requiresPassword: boolean
  maxDownloads: number | null
  downloadCount: number
  remainingDownloads: number | null
  status: ShareStatus
}

export interface CreateShareInput {
  path: string
  days: number
  password?: string
  maxDownloads?: number | null
}

export interface UpdateShareInput {
  isEnabled?: boolean
  days?: number
  password?: string | null
  maxDownloads?: number | null
}

export interface DownloadGrant {
  downloadUrl: string
  expiresAt: string
}
