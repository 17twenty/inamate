import type { PathCommand } from '../types/document'
import type { Matrix2D } from './matrix'

export interface RenderCommand {
  type: 'path' | 'image'
  objectId: string
  transform: Matrix2D
  path?: PathCommand[]
  fill?: string
  stroke?: string
  strokeWidth?: number
  opacity: number
  assetId?: string
}
