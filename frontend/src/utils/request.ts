import { ElMessage } from 'element-plus'
import router from '../router'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function readResponseBody(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null)
  }
  return response.text().catch(() => '')
}

function handleUnauthorized(): void {
  localStorage.removeItem('token')
  localStorage.removeItem('username')
  ElMessage.error('登录状态已过期，请重新登录')
  void router.push('/login')
}

export async function request(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('token')
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(url, { ...options, headers })
  if (response.status === 401) {
    handleUnauthorized()
    throw new ApiError('登录状态已过期', 401)
  }
  return response
}

export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await request(url, options)
  const body = await readResponseBody(response)
  if (!response.ok || body?.success === false) {
    const message = Array.isArray(body?.message)
      ? body.message.join('；')
      : body?.message || `请求失败（HTTP ${response.status}）`
    throw new ApiError(message, response.status)
  }
  return body as T
}

export function getAuthToken(): string {
  return localStorage.getItem('token') || ''
}

export function expireSession(): void {
  handleUnauthorized()
}


