// 2D affine transform matrix as [a, b, c, d, e, f]
// Represents:
// | a c e |
// | b d f |
// | 0 0 1 |
export type Matrix2D = [number, number, number, number, number, number]

export function identity(): Matrix2D {
  return [1, 0, 0, 1, 0, 0]
}

export function multiply(a: Matrix2D, b: Matrix2D): Matrix2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

export function fromTransform(t: {
  x: number
  y: number
  sx: number
  sy: number
  r: number
  ax: number
  ay: number
}): Matrix2D {
  const cos = Math.cos(t.r)
  const sin = Math.sin(t.r)

  // Compose: translate(x,y) * translate(ax,ay) * rotate(r) * scale(sx,sy) * translate(-ax,-ay)
  // Step 1: scale
  let m: Matrix2D = [t.sx, 0, 0, t.sy, 0, 0]

  // Step 2: rotate
  const rot: Matrix2D = [cos, sin, -sin, cos, 0, 0]
  m = multiply(rot, m)

  // Step 3: translate(-ax, -ay) before, translate(ax, ay) + translate(x, y) after
  // Final translation: x + ax - (ax * cos * sx - ay * sin * sy) and similar for y
  const tx = t.x + t.ax - (t.ax * cos * t.sx - t.ay * sin * t.sy)
  const ty = t.y + t.ay - (t.ax * sin * t.sx + t.ay * cos * t.sy)

  m[4] = tx
  m[5] = ty

  return m
}
