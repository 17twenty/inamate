package engine

import "math"

// Matrix2D represents a 2D affine transformation matrix.
// Layout: [a, b, c, d, e, f] representing:
// | a  c  e |
// | b  d  f |
// | 0  0  1 |
//
// Where:
// - a, d = scale
// - b, c = skew/rotation
// - e, f = translation
type Matrix2D [6]float64

// Identity returns the identity matrix.
func Identity() Matrix2D {
	return Matrix2D{1, 0, 0, 1, 0, 0}
}

// Translate returns a translation matrix.
func Translate(tx, ty float64) Matrix2D {
	return Matrix2D{1, 0, 0, 1, tx, ty}
}

// Scale returns a scale matrix.
func Scale(sx, sy float64) Matrix2D {
	return Matrix2D{sx, 0, 0, sy, 0, 0}
}

// Rotate returns a rotation matrix (angle in radians).
func Rotate(radians float64) Matrix2D {
	cos := math.Cos(radians)
	sin := math.Sin(radians)
	return Matrix2D{cos, sin, -sin, cos, 0, 0}
}

// RotateDegrees returns a rotation matrix (angle in degrees).
func RotateDegrees(degrees float64) Matrix2D {
	return Rotate(degrees * math.Pi / 180.0)
}

// Multiply multiplies this matrix by another: result = m * other
// This applies 'other' first, then 'm'.
func (m Matrix2D) Multiply(other Matrix2D) Matrix2D {
	return Matrix2D{
		m[0]*other[0] + m[2]*other[1],        // a
		m[1]*other[0] + m[3]*other[1],        // b
		m[0]*other[2] + m[2]*other[3],        // c
		m[1]*other[2] + m[3]*other[3],        // d
		m[0]*other[4] + m[2]*other[5] + m[4], // e
		m[1]*other[4] + m[3]*other[5] + m[5], // f
	}
}

// TransformPoint applies the matrix to a point.
func (m Matrix2D) TransformPoint(x, y float64) (float64, float64) {
	return m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]
}

// TransformRect transforms a rectangle and returns its axis-aligned bounding box.
func (m Matrix2D) TransformRect(r Rect) Rect {
	// Transform all four corners
	x0, y0 := m.TransformPoint(r.X, r.Y)
	x1, y1 := m.TransformPoint(r.X+r.Width, r.Y)
	x2, y2 := m.TransformPoint(r.X+r.Width, r.Y+r.Height)
	x3, y3 := m.TransformPoint(r.X, r.Y+r.Height)

	// Find axis-aligned bounding box
	minX := min(x0, min(x1, min(x2, x3)))
	minY := min(y0, min(y1, min(y2, y3)))
	maxX := max(x0, max(x1, max(x2, x3)))
	maxY := max(y0, max(y1, max(y2, y3)))

	return Rect{
		X:      minX,
		Y:      minY,
		Width:  maxX - minX,
		Height: maxY - minY,
	}
}

// Determinant returns the determinant of the matrix.
func (m Matrix2D) Determinant() float64 {
	return m[0]*m[3] - m[1]*m[2]
}

// Invert returns the inverse of the matrix, or Identity if not invertible.
func (m Matrix2D) Invert() Matrix2D {
	det := m.Determinant()
	if det == 0 {
		return Identity()
	}

	invDet := 1.0 / det
	return Matrix2D{
		m[3] * invDet,
		-m[1] * invDet,
		-m[2] * invDet,
		m[0] * invDet,
		(m[2]*m[5] - m[3]*m[4]) * invDet,
		(m[1]*m[4] - m[0]*m[5]) * invDet,
	}
}

// FromTransform creates a matrix from document transform properties.
// This composes: Translate(x, y) * Rotate(r) * Scale(sx, sy) * Translate(-ax, -ay)
// The anchor point (ax, ay) is the rotation/scale center.
func FromTransform(x, y, sx, sy, rDegrees, ax, ay float64) Matrix2D {
	rad := rDegrees * math.Pi / 180.0
	cos := math.Cos(rad)
	sin := math.Sin(rad)

	// Combine all operations into a single matrix:
	// T(x,y) * R(r) * S(sx,sy) * T(-ax,-ay)
	//
	// Working through the math:
	// Let's denote the composed transform:
	// First translate by (-ax, -ay): point becomes (px-ax, py-ay)
	// Scale: ((px-ax)*sx, (py-ay)*sy)
	// Rotate: (cos*...-sin*..., sin*...+cos*...)
	// Translate by (x,y): add (x, y)

	return Matrix2D{
		cos * sx,                       // a
		sin * sx,                       // b
		-sin * sy,                      // c
		cos * sy,                       // d
		x + ax - cos*sx*ax + sin*sy*ay, // e
		y + ay - sin*sx*ax - cos*sy*ay, // f
	}
}

// ToSlice returns the matrix as a float64 slice for JSON serialization.
func (m Matrix2D) ToSlice() []float64 {
	return []float64{m[0], m[1], m[2], m[3], m[4], m[5]}
}

// IsIdentity checks if this is the identity matrix (within epsilon).
func (m Matrix2D) IsIdentity() bool {
	const eps = 1e-10
	return math.Abs(m[0]-1) < eps &&
		math.Abs(m[1]) < eps &&
		math.Abs(m[2]) < eps &&
		math.Abs(m[3]-1) < eps &&
		math.Abs(m[4]) < eps &&
		math.Abs(m[5]) < eps
}
