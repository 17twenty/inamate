import { apiFetch } from './client'

export interface User {
  id: string
  email: string
  displayName: string
}

export interface AuthResult {
  token: string
  user: User
}

export function login(email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function register(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResult> {
  return apiFetch<AuthResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  })
}
